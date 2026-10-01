# PPI interview demo — 5–7 minutes

## Prepare

From the repository root, with dependencies and Playwright Chromium installed, run `npm run demo`. It starts an isolated Vite shell on `127.0.0.1:4173` and opens a controlled Chromium window. The address is prefilled: **1847 Synthetic Alder Lane, Apt 2, Demo City, CA 90000**. Click Search when ready.

The visible banner identifies synthetic property/context records, a prepared explanation, and a schematic map. This session reads no env files, makes no provider or database calls, blocks external browser requests, and holds demo records only in memory. Numbers are calculated by the actual shared pricing engine from hand-authored sales. Close the window or press Ctrl+C to reset. Port 4173 must be free. If Chromium is missing, install it with `npx playwright install chromium` before the interview.

Use this prepared session for a reliable demo. Do not imply that it verifies provider access or draws the production ArcGIS basemap. Normal `npm run dev` uses the real server and database and may call providers on cache misses. No synthetic fallback exists in that workflow.

## Walkthrough

| Time | Action | Talking point |
| --- | --- | --- |
| 0:00–0:35 | Show Dashboard before Search | “PPI is a pricing decision prototype for real estate agent workflows, driven by geospatial and market evidence. It supports a pricing conversation, not a formal appraisal.” Identify the synthetic-demo banner. |
| 0:35–1:10 | Click Search; show subject summary and unit | Explain subject identity and effective property facts. Production uses a 14-day profile cache, separate market caches, provider-fetched timestamps, and user overrides. The prepared session simulates this API boundary. |
| 1:10–1:55 | Inspect recorded sales and active listings; select a sale row, then an asking-price marker | Show bidirectional table/map selection. Sold prices are recorded-sale evidence; active asks are competitive context. No inactive ask or provider AVM is treated as a sale. |
| 1:55–2:50 | Select Schools, Grocery, Wildfire, then Faults; click Faults again to turn it off | Schools honestly reports assignment unavailable. Grocery shows a synthetic transient place. Hazard/fault overlays switch exclusively while subject/comparable markers remain. These are informational contexts, with no numeric price adjustment or safety inference. |
| 2:50–3:45 | Open Offer Price | Show suggested **$800,000** and reference range **$780,000–$820,000** for this synthetic fixture. Inspect comparable inclusion decisions and “Price calculated by PPI pricing engine; explanation AI-assisted.” The displayed prose is prepared for the offline demo; production validates structured OpenAI output against frozen evidence. Press Escape and show focus returns to the button. |
| 3:45–4:30 | Open Listing Price; close | The same market reference supports a seller strategy. Strategy settings change deterministic positioning. OpenAI provides explanation/assumptions, not numeric authority; if explanation fails, numbers remain available. |
| 4:30–5:40 | Open History, View the subject, then Refresh; reopen latest Offer and Listing | Current synthetic area changes from 2,000 to 2,400 sqft. Both saved analyses retain their original prices and run IDs. Historical reopen does not recalculate or make a new model call. Show version metadata and optional notes/override editing; editing notes does not refresh provider freshness. |
| 5:40–6:15 | Return Dashboard | Summarize the evidence/engine/explanation boundaries and the limits: prototype, simple unvalidated pricing model, informational GIS, unavailable verified school assignments, transient grocery results. Mention Controlled Agent Evidence Expansion as future work. |

If time permits, demonstrate a confirmed delete of the synthetic property from History. Its demo analyses disappear with it. The browser tests also exercise this flow plus provider failures, insufficient evidence, and stale-response races.

## Useful answers

- **Why deterministic pricing?** The eligible sales, weights, exclusions, inputs, and exact result can be inspected and reopened. An explanation failure does not erase the calculation.
- **Why separate contexts?** School assignment needs verified evidence. Places has a transient display boundary. Hazard layers describe datasets; none becomes an unsupported price adjustment.
- **What is frozen?** The locally runnable core prototype and its synthetic demo. Cloud, Ubuntu, multi-user security, statistical valuation validation, and agent workflows are separate work.

**Controlled Agent Workflow intentionally deferred to post-MVP enhancement.**
