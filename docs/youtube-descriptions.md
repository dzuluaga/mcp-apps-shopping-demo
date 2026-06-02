# YouTube descriptions

Copy-paste blocks for the demo Shorts.

## Claude native app video

### Title
Shopping inside Claude — an Agentic MCP App (live demo)

### Description
Watch an agentic shopping flow run entirely inside the Claude native app. A small embedded widget shows a product grid where you adjust quantities right on each card — everything else (confirming the cart, answering product questions, checkout) is driven by Claude in chat, not the iframe.

This mirrors how real Claude/Gemini commerce connectors work: the agent builds and edits the cart conversationally but never places the order or takes payment. Checkout is a hand-off to an external (mock) merchant page where you finish the purchase with your own account.

In this clip:
• Browse the catalog and add items with the per-card stepper
• Edit the cart by talking ("drop the webcam", "make it two keyboards")
• Claude confirms the cart and total in chat
• Checkout hands off to a mock merchant page — no real charge

Built on the MCP Apps SDK (one UI bundle, runtime host detection) and deployed as an authless custom connector. Works in Claude on web, desktop, and mobile.

Try it yourself — add this custom connector URL:
https://mcp-apps-nine.vercel.app/mcp

Source: https://github.com/dzuluaga/mcp-apps-shopping-demo

#Claude #MCP #AIAgents #Anthropic #AgenticAI #ModelContextProtocol

## ChatGPT video (cart hand-off)

### Title
Shopping inside ChatGPT — an Agentic MCP App (live demo)

### Description
Watch an agentic shopping flow run entirely inside ChatGPT. A small embedded widget shows a product grid where you adjust quantities right on each card — everything else (confirming the cart, answering product questions, checkout) is driven by the agent in chat, not the iframe.

This mirrors how real commerce connectors work: the agent builds and edits the cart conversationally but never places the order or takes payment. Checkout is a hand-off to an external (mock) merchant page where you finish the purchase with your own account.

In this clip:
• Browse the catalog and add items with the per-card stepper
• Edit the cart by talking ("drop the webcam", "make it two keyboards")
• The agent confirms the cart and total in chat
• Checkout hands off to a mock merchant page — no real charge

The same UI bundle runs in ChatGPT via the window.openai bridge (text/html+skybridge), with runtime host detection. Deployed as an authless custom connector — add it in ChatGPT developer mode.

Try it yourself — add this custom connector URL:
https://mcp-apps-nine.vercel.app/mcp

Source: https://github.com/dzuluaga/mcp-apps-shopping-demo

#ChatGPT #MCP #AIAgents #OpenAI #AgenticAI #ModelContextProtocol

## Claude desktop (claude.ai) video

### Title
Shopping inside Claude Desktop — an Agentic MCP App (live demo)

### Description
A live walkthrough of an agentic shopping flow inside the Claude desktop app. The embedded product-picker widget renders inline — browse the catalog and adjust quantities right on each card — while everything conversational (reading the cart, totals, checkout) is driven by Claude in chat, not the iframe.

In this clip:
• The picker opens inline with 8 products and per-card steppers
• Adjust quantities on the cards; the cart badge updates live (6 in cart · $614)
• Ask "How many products are in my cart?" → Claude calls get-cart and answers
• Ask "How much is the total?" → Claude reports the cart total in chat
• Checkout hands off to a mock merchant page — no real charge

This mirrors how real Claude/Gemini commerce connectors work: the agent builds and edits the cart conversationally but never places the order or takes payment. Built on the MCP Apps SDK (one UI bundle, runtime host detection), deployed as an authless custom connector that works in Claude on web, desktop, and mobile — and in ChatGPT developer mode.

Try it yourself — add this custom connector URL:
https://mcp-apps-nine.vercel.app/mcp

Source: https://github.com/dzuluaga/mcp-apps-shopping-demo

#Claude #MCP #AIAgents #Anthropic #AgenticAI #ModelContextProtocol

## Claude — Digital Payment Credentials + AP2 checkout (live demo)

URL: https://www.youtube.com/shorts/JA91c2d2DhQ

### Title
Paying inside Claude with Digital Payment Credentials — AP2 Checkout & Payment Mandate

### Description
A shopping agent inside the Claude native app, taken all the way to a real payment authorization. Claude builds the cart conversationally, then hands off to a merchant checkout that proves the purchase with a Digital Payment Credential — not a stored card on file.

At checkout the cart the user approved becomes an AP2 Checkout Mandate (the exact amount, currency, and payee). Authorization runs cross-device: the desktop renders a QR, your phone's wallet scans it over the FIDO caBLE hybrid transport, and the wallet returns an OpenID4VP presentation that signs over a transaction_data_hash — a SHA-256 binding of that exact amount and payee. The server re-derives the hash and assembles an AP2-shaped Payment Mandate; it never trusts a "verified" flag.

In this clip:
• Browse and edit the cart with Claude in chat
• Checkout hands off to the merchant page — Claude never takes payment
• Cross-device authorization via the Digital Credentials API (phone wallet, FIDO caBLE)
• The wallet cryptographically signs the amount + payee (transaction_data_hash)
• Server produces an AP2 Payment Mandate and runs four deterministic gates: Amount binding, Authorization present, Credential not expired, Subject binding

Why it matters: the agent authorizes payment with a user-held, cryptographically bound credential instead of asserting a charge. The amount the user saw is the amount that was signed.

No real money — mock merchant and a self-signed reader (expect an "unverified verifier" warning). Built on the MCP Apps SDK (one UI bundle, runtime host detection), deployed as an authless custom connector.

Try it yourself — add this custom connector URL:
https://mcp-apps-nine.vercel.app/mcp

Source: https://github.com/dzuluaga/mcp-apps-shopping-demo

#Claude #MCP #AP2 #AgenticCommerce #DigitalCredentials #OpenID4VP #AIAgents #Anthropic #AgenticAI

## ChatGPT — Digital Payment Credentials + AP2 checkout (live demo)

URL: https://youtube.com/shorts/8rMx5P1AOgI

### Title
Paying inside ChatGPT with Digital Payment Credentials — AP2 Checkout & Payment Mandate

### Description
A shopping agent inside ChatGPT, taken all the way to a real payment authorization. The agent builds the cart conversationally, then hands off to a merchant checkout that proves the purchase with a Digital Payment Credential — not a stored card on file.

At checkout the cart the user approved becomes an AP2 Checkout Mandate (the exact amount, currency, and payee). Authorization runs cross-device: the desktop renders a QR, your phone's wallet scans it over the FIDO caBLE hybrid transport, and the wallet returns an OpenID4VP presentation that signs over a transaction_data_hash — a SHA-256 binding of that exact amount and payee. The server re-derives the hash and assembles an AP2-shaped Payment Mandate; it never trusts a "verified" flag.

In this clip:
• Browse and edit the cart with the agent in chat
• Checkout hands off to the merchant page — the agent never takes payment
• Cross-device authorization via the Digital Credentials API (phone wallet, FIDO caBLE)
• The wallet cryptographically signs the amount + payee (transaction_data_hash)
• Server produces an AP2 Payment Mandate and runs four deterministic gates: Amount binding, Authorization present, Credential not expired, Subject binding

Why it matters: the agent authorizes payment with a user-held, cryptographically bound credential instead of asserting a charge. The amount the user saw is the amount that was signed.

The same UI bundle runs in ChatGPT via the window.openai bridge (text/html+skybridge). No real money — mock merchant and a self-signed reader (expect an "unverified verifier" warning). Deployed as an authless custom connector — add it in ChatGPT developer mode.

Try it yourself — add this custom connector URL:
https://mcp-apps-nine.vercel.app/mcp

Source: https://github.com/dzuluaga/mcp-apps-shopping-demo

#ChatGPT #MCP #AP2 #AgenticCommerce #DigitalCredentials #OpenID4VP #AIAgents #OpenAI #AgenticAI

## Claude Code (terminal) — passkey checkout (live demo)

URL: https://youtu.be/5MXRkNJF824

### Title
Agentic Checkout from the Terminal — Claude Code + Passkey Authorization (MCP)

### Description
Agentic commerce isn't just a chat-app thing. Here the shopping + payment MCP server runs inside Claude Code — Anthropic's terminal coding agent. You add the connector to the CLI, then shop and check out without leaving the terminal.

Claude Code drives the cart conversationally and calls the checkout tool, but it never takes payment. Checkout hands off to a merchant page where Authorize payment runs a real WebAuthn passkey ceremony (Touch ID / device passkey) — the "is it really you?" proof of user presence. Control returns to the terminal once you've authorized. Nothing is charged.

In this clip:
• Add the MCP server to Claude Code as an HTTP connector
• Browse and edit the cart from the terminal
• checkout returns a hand-off link — the agent never pays
• Passkey (WebAuthn) user-presence authorization on the merchant page
• Authorization confirmed back in the terminal

The point: a terminal coding agent can run the full agentic-commerce flow, with the authorization step staying on a user-held passkey — not asserted by the agent.

Add it to Claude Code:
claude mcp add --transport http product-picker https://mcp-apps-nine.vercel.app/mcp

Source: https://github.com/dzuluaga/mcp-apps-shopping-demo

#ClaudeCode #MCP #Passkey #WebAuthn #AgenticCommerce #AIAgents #Anthropic #AgenticAI #FIDO

## Claude Code (terminal) — Digital Payment Credentials + AP2 (live demo)

URL: https://youtu.be/GmYu-4M5unY

### Title
Digital Payment Credentials + AP2 in the Terminal — Claude Code MCP Checkout

### Description
Where the passkey flow proves who you are, this one proves what you approved. The Digital Payment Credential / AP2 checkout — running inside Claude Code, Anthropic's terminal coding agent. Same MCP server, no GUI: add the connector to the CLI and take a purchase all the way to a cryptographically bound payment authorization.

Claude Code builds the cart and calls checkout, then hands off to a merchant page. Payment is authorized with a Digital Payment Credential presented via the Digital Credentials API / OpenID4VP, cross-device over FIDO caBLE: the desktop shows a QR, your phone's wallet scans it and signs a transaction_data_hash that binds the exact amount and payee. The server re-derives that hash and assembles an AP2 Checkout + Payment Mandate, running four deterministic gates — it never trusts a "verified" flag.

In this clip:
• Add the MCP server to Claude Code as an HTTP connector
• Shop and check out entirely from the terminal
• Cross-device authorization via the Digital Credentials API (phone wallet, FIDO caBLE)
• Wallet cryptographically signs amount + payee — not just user presence
• Server produces an AP2 Payment Mandate + 4 gates: Amount binding, Authorization present, Credential not expired, Subject binding

Why it matters: the amount you saw is the amount that was signed — and it works from a terminal agent, proving this isn't tied to any one chat surface. No real money; mock merchant, self-signed reader.

Add it to Claude Code:
claude mcp add --transport http product-picker https://mcp-apps-nine.vercel.app/mcp

Source: https://github.com/dzuluaga/mcp-apps-shopping-demo

#ClaudeCode #MCP #AP2 #DigitalCredentials #OpenID4VP #AgenticCommerce #FIDO #AIAgents #Anthropic
