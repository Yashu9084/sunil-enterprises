import { StoreConflictError } from "./mongo-store.js";

// Serializes API access to the disposable projection, including async image
// processing/PDF streams. Successful writes are withheld until MongoDB commits.
export function durableApi(store) {
  let tail = Promise.resolve();
  return async (req, res, next) => {
    const previous = tail;
    let release;
    tail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    if (res.destroyed) {
      release();
      return;
    }
    let released = false;
    const unlock = () => {
      if (!released) {
        released = true;
        release();
      }
    };
    try {
      await store.refresh();
    } catch (error) {
      console.error("Ledger refresh failed", error.name, error.code || "");
      unlock();
      res.status(503).json({
        error:
          "Shop database is unavailable. Nothing was saved. Please try again shortly.",
      });
      return;
    }
    const extraction =
      req.method === "POST" &&
      req.path.toLowerCase().replace(/\/+$/, "") === "/estimates/extract";
    if (["GET", "HEAD", "OPTIONS"].includes(req.method) || extraction) {
      // The extraction route copies its authenticated context before releasing
      // this read lock. No ledger access is allowed after that release.
      if (extraction) req.releaseProjection = unlock;
      res.once("finish", unlock);
      res.once("close", unlock);
      next();
      return;
    }
    const write = res.write.bind(res),
      end = res.end.bind(res);
    const chunks = [];
    let ending = false;
    // Do not release on a client disconnect: the handler may still be running
    // and a payment may be committing. The same request ID makes retries safe.
    res.write = (chunk, encoding, callback) => {
      if (chunk)
        chunks.push(
          Buffer.isBuffer(chunk)
            ? chunk
            : Buffer.from(
                chunk,
                typeof encoding === "string" ? encoding : undefined,
              ),
        );
      const cb = typeof encoding === "function" ? encoding : callback;
      if (cb) queueMicrotask(cb);
      return true;
    };
    res.end = (chunk, encoding, callback) => {
      if (ending) return res;
      ending = true;
      if (chunk) res.write(chunk, encoding);
      const cb =
        typeof chunk === "function"
          ? chunk
          : typeof encoding === "function"
            ? encoding
            : callback;
      void (async () => {
        try {
          if (res.statusCode < 400) await store.persist();
          else store.invalidate();
          res.write = write;
          res.end = end;
          end(Buffer.concat(chunks), cb);
        } catch (error) {
          store.invalidate();
          res.write = write;
          res.end = end;
          for (const name of [
            "Content-Length",
            "Content-Disposition",
            "Content-Encoding",
            "Set-Cookie",
            "ETag",
          ])
            res.removeHeader(name);
          res.statusCode = error instanceof StoreConflictError ? 409 : 503;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          end(
            JSON.stringify({
              error:
                error instanceof StoreConflictError
                  ? "Records changed in another session. Refresh and retry the same entry."
                  : "Could not confirm the database save. Refresh and retry the same entry; do not create a new payment.",
            }),
            cb,
          );
        } finally {
          unlock();
        }
      })();
      return res;
    };
    next();
  };
}
