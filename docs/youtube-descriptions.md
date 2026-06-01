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

Source: https://github.com/dfzuluaga/mcp-apps-shopping-demo

#Claude #MCP #AIAgents #Anthropic #AgenticAI #ModelContextProtocol

## ChatGPT video

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

Source: https://github.com/dfzuluaga/mcp-apps-shopping-demo

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

Source: https://github.com/dfzuluaga/mcp-apps-shopping-demo

#Claude #MCP #AIAgents #Anthropic #AgenticAI #ModelContextProtocol
