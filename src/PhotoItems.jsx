import React, { useRef, useState } from "react";
import { Camera, Check, Trash2, X } from "lucide-react";
import { tr } from "./i18n.js";
import { api, money, paise } from "./lib.js";
import { calculateItems } from "../shared/money.js";

async function photoData(file) {
  if (file.size > 20 * 1024 * 1024)
    throw Error("Choose a photo smaller than 20 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (image.naturalWidth * image.naturalHeight > 25000000)
      throw Error("Photo is too large. Use a smaller camera photo.");
    const scale = Math.min(
      1,
      2560 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.92);
  } catch (error) {
    throw Error(
      error.message.includes("large")
        ? error.message
        : "Could not open this photo. Use a JPG, PNG or WebP image.",
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
export function PhotoItems({ mode, offline, busy, t, onApply, available }) {
  const [image, setImage] = useState(null),
    [reading, setReading] = useState(false),
    [result, setResult] = useState(null),
    [rows, setRows] = useState([]),
    [error, setError] = useState("");
  const [totalAcknowledged, setTotalAcknowledged] = useState(false);
  const generation = useRef(0),
    currentMode = useRef(mode);
  currentMode.current = mode;
  const readMode = useRef(mode);
  const locked = reading || busy || offline;
  const patch = (index, key, value) => {
    setTotalAcknowledged(false);
    setRows(
      rows.map((r, i) =>
        i === index ? { ...r, [key]: value, checked: false } : r,
      ),
    );
  };
  const rowTotal = (row) => {
    try {
      if (paise(row.price) === 0 && row.qty && row.name) return 0;
      return calculateItems(
        [
          {
            name: row.name,
            qty: row.qty,
            price: paise(row.price),
            gst: row.gst,
          },
        ],
        mode,
      ).total;
    } catch {
      return null;
    }
  };
  const valid = (row) => {
    try {
      const price = paise(row.price);
      calculateItems(
        [
          {
            name: row.name,
            qty: row.qty,
            price: price || 1,
            gst: mode === "gst" ? row.gst : 0,
          },
        ],
        mode,
      );
      return mode !== "gst" || row.gst !== "";
    } catch {
      return false;
    }
  };
  const sum =
    rows.every(valid) && rows.length
      ? rows.reduce((s, r) => s + rowTotal(r), 0)
      : null;
  const totalsDiffer =
    result &&
    sum !== null &&
    result.written_total !== null &&
    sum !== result.written_total;
  const canApply =
    (!totalsDiffer || totalAcknowledged) &&
    result &&
    readMode.current === mode &&
    rows.length &&
    rows.every((r) => r.checked && valid(r)) &&
    !locked;
  return (
    <details
      className="photo-reader"
      aria-label={t("Read items from a photo", "फोटो से सामान पढ़ें")}
    >
      <summary>
        <Camera size={21} />{" "}
        {t("Read items from a photo", "फोटो से सामान पढ़ें")}
      </summary>
      <p>
        {t(
          "Upload the handwritten list. Check each line, then add it to this estimate.",
          "हाथ से लिखी सूची की फोटो डालें। हर लाइन जाँचकर इस अनुमान में जोड़ें।",
        )}
      </p>
      <p className="hint">
        {t(
          "The photo is sent to OpenAI to read it. AI can misread handwriting. Nothing is saved to the accounts here.",
          "फोटो पढ़ने के लिए OpenAI को भेजी जाएगी। AI लिखावट गलत पढ़ सकता है। यहाँ से खाते में कुछ सेव नहीं होता।",
        )}
      </p>
      {available === false && (
        <p className="scan-warning">
          {t(
            "Photo reading needs the owner's private OpenAI API key in Render. You can still enter items manually.",
            "फोटो पढ़ने के लिए मालिक को Render में निजी OpenAI API key जोड़नी होगी। अभी सामान हाथ से भर सकते हैं।",
          )}
        </p>
      )}
      <label className="upload">
        <Camera size={20} />{" "}
        {t("Choose / take a list photo", "सूची की फोटो चुनें / खींचें")}
        <input
          type="file"
          aria-label="Photo to read items"
          accept="image/png,image/jpeg,image/webp"
          disabled={locked}
          onChange={async (e) => {
            const file = e.target.files[0];
            e.target.value = "";
            if (!file) return;
            const id = ++generation.current;
            setError("");
            setResult(null);
            setRows([]);
            setImage(null);
            setReading(true);
            try {
              const value = await photoData(file);
              if (id === generation.current) setImage(value);
            } catch (error) {
              if (id === generation.current) setError(error.message);
            } finally {
              if (id === generation.current) setReading(false);
            }
          }}
        />
      </label>
      {image && (
        <>
          <a
            href={image}
            target="_blank"
            rel="noreferrer"
            className="scan-photo-link"
          >
            {t("Open full photo", "पूरी फोटो खोलें")}
          </a>
          <img
            className="scan-photo"
            src={image}
            alt={t(
              "Original handwritten list to check",
              "जाँचने के लिए हाथ से लिखी मूल सूची",
            )}
          />
          <button
            type="button"
            className="secondary"
            disabled={locked || available === false}
            onClick={async () => {
              const id = ++generation.current,
                selectedMode = mode;
              setReading(true);
              setError("");
              setResult(null);
              setRows([]);
              setTotalAcknowledged(false);
              try {
                const extracted = await api("estimates/extract", {
                  image,
                  tax_mode: selectedMode,
                });
                if (id !== generation.current) return;
                if (currentMode.current !== selectedMode)
                  throw Error("GST category changed. Read the photo again.");
                readMode.current = selectedMode;
                setResult(extracted);
                setRows(
                  extracted.items.map((row) => ({ ...row, checked: false })),
                );
                if (!extracted.items.length)
                  setError(
                    t(
                      "No items could be read. Try a closer, flatter photo.",
                      "सामान पढ़ा नहीं गया। पास से और सीधी फोटो लें।",
                    ),
                  );
              } catch (error) {
                if (id === generation.current) setError(error.message);
              } finally {
                if (id === generation.current) setReading(false);
              }
            }}
          >
            {reading
              ? t("Reading the handwriting…", "लिखावट पढ़ रहे हैं…")
              : t("Read this photo", "यह फोटो पढ़ें")}
          </button>
        </>
      )}
      {reading && (
        <p role="status">
          {t(
            "This can take up to a minute. Keep this window open.",
            "इसमें एक मिनट लग सकता है। यह स्क्रीन खुली रखें।",
          )}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {tr(error)}
        </p>
      )}
      {result && (
        <div className="scan-review">
          <h3>{t("Check against the photo", "फोटो से मिलाकर जाँचें")}</h3>
          {result.warnings.map((w, i) => (
            <p className="scan-warning" key={i}>
              {tr(w)}
            </p>
          ))}
          {readMode.current !== mode && (
            <p role="alert" className="error">
              {t(
                "GST category changed. Read the photo again.",
                "GST श्रेणी बदल गई है। फोटो फिर पढ़ें।",
              )}
            </p>
          )}
          {rows.map((row, index) => (
            <div className="scan-row" key={index}>
              <div className="scan-row-heading">
                <strong>
                  {t("Line", "लाइन")} {index + 1}
                </strong>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remove scanned line ${index + 1}`}
                  disabled={locked}
                  onClick={() => {
                    setRows(rows.filter((_, i) => i !== index));
                    setTotalAcknowledged(false);
                  }}
                >
                  <Trash2 size={18} />
                </button>
              </div>
              <p className="scan-original">{row.raw_text}</p>
              {row.uncertain_fields.length > 0 && (
                <p className="scan-warning">
                  {t(
                    "Unclear reading — compare carefully with the photo.",
                    "लिखावट स्पष्ट नहीं है — फोटो से ध्यान से मिलाएँ।",
                  )}
                </p>
              )}
              {row.notes && <p>{row.notes}</p>}
              <label>
                {t("Item / part number", "सामान / पार्ट नंबर")}
                <input
                  aria-label={`Scanned item ${index + 1}`}
                  maxLength={200}
                  value={row.name}
                  onChange={(e) => patch(index, "name", e.target.value)}
                  disabled={locked}
                />
              </label>
              <div className="scan-numbers">
                <label>
                  {t("Quantity", "मात्रा")}
                  <input
                    aria-label={`Scanned quantity ${index + 1}`}
                    type="number"
                    min="0.001"
                    max="100000"
                    step="0.001"
                    value={row.qty}
                    onChange={(e) => patch(index, "qty", e.target.value)}
                    disabled={locked}
                  />
                </label>
                <label>
                  {t("Unit rate ₹", "एक का भाव ₹")}
                  <input
                    aria-label={`Scanned rate ${index + 1}`}
                    inputMode="decimal"
                    value={row.price}
                    onChange={(e) => patch(index, "price", e.target.value)}
                    disabled={locked}
                  />
                </label>
                {mode === "gst" && (
                  <label>
                    GST %
                    <input
                      aria-label={`Scanned GST ${index + 1}`}
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={row.gst}
                      onChange={(e) => patch(index, "gst", e.target.value)}
                      disabled={locked}
                    />
                  </label>
                )}
              </div>
              <p>
                {t("Calculated amount", "गिनती के बाद राशि")}:{" "}
                <strong>
                  {rowTotal(row) === null ? "—" : money(rowTotal(row))}
                </strong>
                {row.line_amount !== null && (
                  <>
                    {" "}
                    · {t("Read from photo", "फोटो में पढ़ी राशि")}:{" "}
                    {money(row.line_amount)}
                  </>
                )}
              </p>
              {row.line_amount !== null &&
                rowTotal(row) !== null &&
                row.line_amount !== rowTotal(row) && (
                  <p className="scan-warning">
                    {t(
                      "Amounts do not match. Check the quantity, rate and written total.",
                      "राशि नहीं मिल रही। मात्रा, भाव और लिखी कुल राशि जाँचें।",
                    )}
                  </p>
                )}
              <label className="scan-confirm">
                <input
                  type="checkbox"
                  aria-label={`Checked scanned line ${index + 1}`}
                  checked={row.checked}
                  disabled={locked || !valid(row)}
                  onChange={(e) =>
                    setRows(
                      rows.map((r, i) =>
                        i === index ? { ...r, checked: e.target.checked } : r,
                      ),
                    )
                  }
                />
                {t(
                  "I checked the name, part number, quantity and rate against the photo.",
                  "मैंने नाम, पार्ट नंबर, मात्रा और भाव फोटो से मिला लिए हैं।",
                )}
              </label>
            </div>
          ))}
          <div className="scan-summary">
            <p>
              {t("Calculated total", "गिनती से कुल")}:{" "}
              <strong>{sum === null ? "—" : money(sum)}</strong>
            </p>
            <p>
              {t("Total read from photo", "फोटो में पढ़ा कुल")}:{" "}
              <strong>
                {result.written_total === null
                  ? t("Unclear / absent", "अस्पष्ट / नहीं मिला")
                  : money(result.written_total)}
              </strong>
            </p>
            {sum !== null &&
              result.written_total !== null &&
              sum !== result.written_total && (
                <p className="scan-warning">
                  {t(
                    "Totals differ. Check for missing rows or incorrect numbers before adding.",
                    "कुल राशि अलग है। जोड़ने से पहले छूटी लाइन या गलत संख्या जाँचें।",
                  )}
                </p>
              )}
          </div>
          {totalsDiffer && (
            <label className="scan-confirm">
              <input
                type="checkbox"
                checked={totalAcknowledged}
                onChange={(e) => setTotalAcknowledged(e.target.checked)}
                disabled={locked}
              />
              {t(
                "I checked the difference. Use the calculated total from these items.",
                "मैंने अंतर जाँच लिया है। इन सामानों की गिनती से बनी कुल राशि इस्तेमाल करें।",
              )}
            </label>
          )}
          <button
            type="button"
            className="primary full"
            disabled={!canApply}
            onClick={() => {
              if (!canApply) return;
              const applied = onApply(
                rows.map((r) => ({
                  name: r.name.trim(),
                  qty: r.qty,
                  price: r.price,
                  gst: mode === "gst" ? r.gst : 0,
                })),
                result.source_photo,
              );
              if (applied === false) return;
              setResult(null);
              setRows([]);
              setImage(null);
            }}
          >
            <Check size={18} />{" "}
            {t(
              "Add checked items to estimate",
              "जाँचा हुआ सामान अनुमान में जोड़ें",
            )}
          </button>
          <p className="hint">
            {t(
              "Existing items stay. This list photo is kept as reference, not as a customer signature.",
              "पहले का सामान रहेगा। सूची की फोटो संदर्भ के लिए रहेगी, ग्राहक के हस्ताक्षर की जगह नहीं।",
            )}
          </p>
        </div>
      )}
      {(image || result) && (
        <button
          type="button"
          className="text-btn"
          disabled={locked}
          onClick={() => {
            generation.current++;
            setImage(null);
            setResult(null);
            setRows([]);
            setError("");
          }}
        >
          <X size={16} />
          {t("Discard photo reading", "फोटो की पढ़ाई हटाएँ")}
        </button>
      )}
    </details>
  );
}
