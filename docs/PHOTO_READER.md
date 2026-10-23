# Handwritten photo entry

## Enable on your existing Render service

1. Create an OpenAI API project/key at [platform.openai.com](https://platform.openai.com/). API credits/billing are separate from a ChatGPT subscription and Render/Atlas hosting. Review project usage/budget alerts.
2. Open Render → **sunil-enterprises → Environment**. Add `OPENAI_API_KEY` privately, save it, then use **Manual Deploy → Deploy latest commit**. Do not paste the key in chat, source code, a deploy-hook URL or any browser frontend setting.
3. The default vision model is `gpt-4.1`. `OPENAI_VISION_MODEL` can select another model available to your account that supports image inputs and Responses API strict structured output. Model changes should be tested against real shop slips before use.
4. Open **New estimate** or **Purchase**, select the GST/non-GST category, then use **Read items from a photo**. Without a key the app explains configuration and keeps manual entry available. Database and login credentials are unchanged.

## A quick shop workflow

1. Photograph one flat page straight on, with good light, no fingers over writing, and all rows/total visible. Keep part numbers in focus. The picker accepts JPG/PNG/WebP and reduces large phone photos locally; the uploaded image must fit the server's 5 MB/25 MP limits after preparation. No photo is sent to AI merely by selecting it: press **Read this photo**.
2. Compare the editable reading against the photo; **Open full photo** opens a larger view. Read the item and every bearing/model/part number carefully. AI uses the latest saved shop item names only as spelling context, never as evidence for a guessed price.
3. Correct blank/unclear names, quantities, unit rates and GST rates. The reader preserves Hindi/English names and visible part numbers. Missing numbers are not filled with zero, quantity one or a rate inferred by dividing a total. GST is never inferred from the business type.
4. Check each row. Changing a row clears its check. Calculated amounts are shown beside amounts read from the paper. A mismatched page total requires a separate acknowledgement; the application keeps the calculated total rather than adjusting prices to match a possible handwritten mistake. If a row was completely missed, enter it manually after importing, or retake the photo before importing. Never approve a difference you have not understood.
5. **Add checked items to estimate** appends the reviewed rows and retains existing manually entered items. It does not save the estimate, post payments, change balances or select a party. One scanned page is retained per estimate. Use a separate estimate for another page.
6. Select the correct customer/supplier, review the final total, capture the customer signature or attach a genuinely signed-paper photo, then save normally. The scanned list is reference evidence and cannot by itself satisfy the signed-sale requirement. Purchase records keep their existing proof rules.

The original list is retained as a normalized reference photo in the saved document, separate from `signature` and signed `photo`. It appears in record detail, encrypted backups and PDF attachments. Unsaved text drafts may survive a reload, but source photos and signatures are not stored in browser draft storage; reattach evidence after a reload before saving. Do not treat a pending photo reading as saved work.

## Accuracy and privacy

There is no reliable 100% guarantee for doctor's-style handwriting, especially similar digits, crossed-out amounts, bearing codes and partially hidden rows. Readability flags are model assessments, not calibrated probabilities. Every row requires human verification even if the model reported no ambiguity. Arithmetic can detect inconsistencies, but a wrong rate and a wrong total can still agree.

The selected photo and up to 100 recent unique item-name hints are sent from the server to OpenAI when reading is requested. Prices from history, customer balances, API keys and full account statements are not sent as catalog hints. The request uses `store: false`; OpenAI's applicable API data handling/abuse-monitoring policies still apply. The photo and account credentials are never included in application logs by this integration. Anyone entering a photo should have authority to share its contents with the service.

There is one active reading per signed-in user and at most 20 attempts per hour per process. These limits reset on host restart and are not a guaranteed billing cap. Monitor OpenAI account usage. Extraction times out after 60 seconds; failures never post financial entries. The MongoDB ledger lock is released after copying the authorized spelling context, so other shop users can keep working while OpenAI reads a page.

## Estimate layout

The PDF follows a clear ruled estimate-pad layout: quantity, large item/part name, right-aligned unit rate and amount, then a large total. Hindi names wrap inside their column. GST estimates show each line's GST beneath its item; rates remain before GST and line amounts include GST. Continuation pages repeat the estimate reference and table headings. Signed proofs and source-list reference pages retain distinct labels. This remains an estimate, not a statutory GST invoice.

## Verification

`npm test` checks structured extraction, exact rupee-to-paise conversion, unknown-value handling, wrong unit-rate/line-total detection, API-key redaction, authentication, and that source lists cannot substitute for customer signatures. `npm run test:photo-browser` exercises the mobile review/edit/acknowledgement flow and saved evidence using a mocked AI response. `npm run test:mongo -- --browser` also checks these paths with a real disposable replica set.

Mocked tests verify the integration and financial safeguards, not handwriting recognition quality. Live recognition on the shop's real handwriting has not been benchmarked without a configured API key. Before replacing manual typing, compare a representative set of real slips against the father's transcription, particularly part numbers and rates. Record corrected spellings through normal saved items to improve future catalog context; this is not model fine-tuning.
