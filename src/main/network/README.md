# Live Network & API Stream Interceptor

The **Network Interceptor** (`src/main/network/network-interceptor.ts`) attaches directly to Electron's internal Chrome DevTools Protocol (`CDP`) debugger session (`Network.enable`) to observe all incoming HTTP, XHR, and Fetch payloads at the wire level.

## Why This Matters for Autonomous Agents

Modern Single Page Applications (Skyscanner, Twitter/X, Reddit, airline search engines) do not render all raw data into the DOM. They fetch clean, structured JSON payloads in the background. 

Instead of forcing the LLM to squint at noisy, truncated DOM trees, the Network Interceptor allows the agent to:
1. Inspect live API endpoints fired during user interactions or searches.
2. Directly query and read full JSON payloads returned by internal REST/GraphQL endpoints.
3. Save tokens, preserve 100% data fidelity, and bypass complex HTML scraping.

## Capabilities

- **CDP Debugger Hooking**: Attaches to `webContents.debugger` (`version 1.3`) and listens to `Network.requestWillBeSent`, `Network.responseReceived`, and `Network.loadingFinished`.
- **Payload Buffering**: Automatically fetches and caches response bodies for XHR, Fetch, and JSON endpoints via `Network.getResponseBody`.
- **WebSocket & SSE Stream Interception**: Hooks into `Network.webSocketFrameSent`, `Network.webSocketFrameReceived`, and `Network.eventSourceMessageReceived` to monitor real-time duplex channels and streaming token feeds.
- **Query & Filtering**: Filter captured traffic by URL pattern, HTTP method, MIME type, stream protocol, or direction.
- **In-Memory Ring Buffers**: Caps captured requests at 250 records and stream frames at 500 messages to prevent memory bloat.

## HTTP Bridge API

- `POST /network/traffic` - `{ "urlPattern": "api", "method": "GET", "limit": 20 }` -> returns matching requests with status and body preview snippets.
- `POST /network/payload` - `{ "requestId": "<id>" }` -> returns the full decoded JSON or text payload.
- `POST /network/clear` -> clears network traffic buffers.
- `POST /streams/list` - `{ "type": "websocket", "activeOnly": true }` -> lists observed WebSocket and SSE streams.
- `POST /streams/messages` - `{ "streamId": "...", "limit": 20 }` -> retrieves rolling sent/received stream frames.
- `POST /streams/clear` -> clears stream message buffers.

## MCP Tools

- `get_network_traffic`: Get captured HTTP/XHR/Fetch requests matching optional filters.
- `get_api_payload`: Inspect the full raw JSON response body from any captured network request.
- `clear_network_traffic`: Clears the network traffic ring buffer.
- `list_realtime_streams`: Lists active WebSocket connections and open SSE channels.
- `get_stream_messages`: Inspects captured frames/messages streaming over a WebSocket or SSE connection.
- `clear_stream_messages`: Clears the in-memory WebSocket and SSE message frame buffer.
