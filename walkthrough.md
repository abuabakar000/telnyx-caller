# Call Dialer & SMS CRM - Implementation Walkthrough

The browser-based call dialer has been successfully updated and is running with a complete SMS CRM Outreach Suite integrated. It uses Next.js (App Router), Tailwind CSS (v4), Prisma (MongoDB Atlas), Pusher, and `@telnyx/webrtc` to implement voice calling and real-time SMS outreach.

---

## Layout Fix (Drawer Overlays)

### The Issue
Originally, opening the **Leads** (Lead Queue) or **Pipeline** (Kanban Pipeline) panels pushed the central Dialer component, eating into its horizontal space. Since the Dialer expects a minimum width of ~1016px (`lg:grid-cols-[20rem_22rem_20rem]` plus gaps), this caused layout compression and broke page layout aesthetics when either panel was toggled.

### The Fix
1. **Floating Side Drawers**:
   - The side panels are now rendered as absolute floating cards with a backdrop overlay.
   - Clicking on "Leads" slides the Leads queue from the left (`animate-slide-in-left`).
   - Clicking on "Pipeline" slides the Pipeline queue from the right (`animate-slide-in-right`).
   - Both panels float beautifully over the page (with a `1rem` margin) on top of a subtle, blurred backdrop (`backdrop-blur-xs bg-black/50`).
2. **External Close Buttons**:
   - A floating close button is attached outside the cards (`absolute -right-12 top-4` / `-left-12 top-4`) so users can explicitly close them.
   - Users can also close the drawers by clicking anywhere on the dimmed backdrop.
3. **No Squeezing of Dialer**:
   - The Dialer component is kept centered and gets 100% of the main area width, resolving all horizontal compression and overflow issues.
4. **Full-height Scale**:
   - Modified `LeadQueue.tsx` and `KanbanPipeline.tsx` containers to scale dynamically to `h-full`, fitting perfectly within the drawer wrapper constraints.

---

## Verification

```
▲ Next.js 16.2.7 (Turbopack)
- Environments: .env.local, .env

  Creating an optimized production build ...
✓ Compiled successfully in 8.8s
  Running TypeScript ...
  Finished TypeScript in 10.4s ...
  Collecting page data using 3 workers ...
  Generating static pages using 3 workers (6/6) in 603ms
  Finalizing page optimization ...
```

**Zero type errors. Zero warnings. Clean production build.**

---

## 🚀 NEW FEATURES: SMS CRM OUTREACH SUITE

We have integrated a full-featured SMS CRM directly alongside the existing calling features:

1. **Tabbed Left Panel (Calls & SMS):**
   - **Calls Tab:** Displays the existing Recent Calls log.
   - **SMS Tab:** Lists conversation threads in real-time, including contact names, last message snippets, status indicators (delivered checkmarks, failed status), opt-out badges (`STOP`), and timestamps.
   - **Threads Search:** A search bar to instantly filter threads by contact name or phone number.
   - **New Chat Trigger:** A button to start a conversation with a new phone number.

2. **Real-time Glassmorphic Chat Drawer:**
   - Clicking a thread opens a modal chat window showing the complete message history.
   - **Inbound vs Outbound Styling:** Inbound messages are on the left (zinc dark bubble), and outbound messages are on the right (emerald glassmorphic bubble).
   - **Outbound Delivery Statuses:** Displays real-time message statuses (`SENT`, `DELIVERED`, `FAILED`).
   - **Detailed Rejection Tooltips:** Displays the exact carrier failure reasons and diagnostic codes (e.g., spam block, compliance filters).
   - **Interactive Dialer Integration:** A dial button in the header loads the contact's number directly into the calling dialer card.
   - **Campaign Templates Dropdown:** Allows choosing campaign templates to quickly populate the input text.
   - **Segment Counter:** Tracks character count and SMS message segments on-the-fly.

3. **Full-Screen SMS CRM Dashboard Overlay:**
   - Activated via the new **"SMS CRM"** button next to the audio settings icon.
   - **Contacts Tab:** Directory of all leads. Supports adding, editing, and deleting leads, adding notes/tags, starting a quick chat, and exporting/importing contacts in CSV format.
   - **Campaign Templates Tab:** Directory of seeded outreach campaign templates. Allows adding, editing, and deleting custom templates.
   - **System Health & Logs Tab (Delivery Diagnostics):** 
     - Displays gauges for Total Sent, Delivery Success Rate (%), Opt-out Rate (%), and Carrier Filtering Blocks.
     - Diagnostic table listing the last 20 block logs (with recipient, carrier name, rejection reason, error code, and timestamp).
     - Reset button to clear statistics and diagnostics cleanly.

4. **Cryptographic Webhook Signature Verification:**
   - Endpoint: `/api/webhooks/telnyx`
   - Validates Telnyx's Ed25519 webhook signatures using `telnyx-signature-ed25519` and `telnyx-timestamp` headers, protecting against spoofing attacks.
   - Updates delivery status and logs diagnostics in real-time.
   - Detects incoming opt-out requests (e.g., if a user sends `STOP`) and automatically flags the contact as "Opted Out".
   - Prevents sending outbound SMS messages to opted-out contacts.

---

## 📞 CALLING FEATURES & STABILITY

1. **Dashboard Layout:**
   - **Left Panel:** Tabbed between Recent Calls and SMS threads.
   - **Middle Panel:** Keypad, progressive display formatter, call timer, settings menu, and WebRTC signal status.
   - **Right Panel (Sound Pad):** 3 uploading slots, master volume, and soundboard mic gain toggle node.
2. **Settings & Quality Tuning:**
   - Gear icon reveals selectors for Microphone, Speaker (with output test chimes), and voice processing controls (**AEC**, **ANS**, **AGC**).
   - Monkey patches `getUserMedia` and `RTCPeerConnection` to inject optimal voice parameters: `maxaveragebitrate=40000`, `useinbandfec=1`, `usedtx=1`.
3. **Web Audio Mixer & Mic Toggle:**
   - Mixes microphone audio and sound pad clips dynamically.
   - Monkey patch intercepts the hardware microphone requests from the Telnyx SDK and injects the mixed stream.
   - Re-creates fresh destination nodes on every call to resolve ended track failure bugs.
4. **WebSocket Connection Recovery:**
   - Monitored raw socket listeners dynamically rebuild the signaling client on unexpected drops using exponential backoff timeouts.

---

## 🛠️ ARCHITECTURE

- [src/app/actions/sms.ts](file:///c:/Users/Abu%20Bakar/Desktop/new%20caller/src/app/actions/sms.ts) - Server Action to send SMS, append STOP compliance footer, update health, and broadcast updates.
- [src/app/actions/contacts.ts](file:///c:/Users/Abu%20Bakar/Desktop/new%20caller/src/app/actions/contacts.ts) - Server Action for contact CRUD and CSV import/export.
- [src/app/actions/templates.ts](file:///c:/Users/Abu%20Bakar/Desktop/new%20caller/src/app/actions/templates.ts) - Server Action for seeded templates and CRUD.
- [src/app/actions/health.ts](file:///c:/Users/Abu%20Bakar/Desktop/new%20caller/src/app/actions/health.ts) - Server Action for health analytics diagnostics retrieval and resetting.
- [src/app/api/webhooks/telnyx/route.ts](file:///c:/Users/Abu%20Bakar/Desktop/new%20caller/src/app/api/webhooks/telnyx/route.ts) - Real-time incoming webhook with Ed25519 signature validation.
- [src/components/Dialer.tsx](file:///c:/Users/Abu%20Bakar/Desktop/new%20caller/src/components/Dialer.tsx) - Unified Voice Dialer and SMS CRM client control panel.
- [prisma/schema.prisma](file:///c:/Users/Abu%20Bakar/Desktop/new%20caller/prisma/schema.prisma) - Prisma schema containing contacts, messages, campaign templates, health logs, and carrier blocks.
- [src/utils/db.ts](file:///c:/Users/Abu%20Bakar/Desktop/new%20caller/src/utils/db.ts) - Persistent singleton Prisma client instance.
- [src/utils/pusher.ts](file:///c:/Users/Abu%20Bakar/Desktop/new%20caller/src/utils/pusher.ts) & [src/utils/pusher-client.ts](file:///c:/Users/Abu%20Bakar/Desktop/new%20caller/src/utils/pusher-client.ts) - Real-time Pusher server and client connections.
