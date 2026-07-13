# 🌐 Browse Agent

An intelligent, autonomous browser automation agent that transforms natural language requests into complex web actions. Unlike simple scrapers, Browse Agent uses a multi-stage AI pipeline to interpret human intent, plan sequences of actions, and interact with the web in real-time.

## ✨ Key Features

- **🧠 Multi-Stage AI Pipeline**: 
  - **Translator**: High-fidelity translation of any language into precise English to ensure logic consistency.
  - **Planner**: An "Interpreter" agent that decomposes complex requests into structured plans (Direct vs. Agent loops).
  - **Agent Loop**: An autonomous loop that navigates, reasons, and executes tools based on real-time page feedback.
- **🚀 Deep Scan Technology**: Automatically triggers lazy-loading of page content during navigation, ensuring elements outside the initial viewport are discoverable.
- **⚡ Real-time Streaming**: Uses SSE (Server-Sent Events) to stream "thinking" and "action" steps to the UI in real-time.
- **📁 Session Management**: Full support for multiple concurrent sessions, allowing you to maintain different browser contexts and histories.
- **🛠 Toolset**: Includes navigation, clicking, typing, content extraction, and automated screenshotting.

## 🏗 Architecture

The agent follows a strict processing pipeline to minimize misinterpretations:

`Human Prompt (Any Lang)` $ightarrow$ `Translator` $ightarrow$ `Planner` $ightarrow$ `Execution Strategy` $ightarrow$ `Browser (Playwright)`

1. **Translator**: Normalizes the input to high-fidelity English.
2. **Planner**: Decides if the task is a **Direct Action** (deterministic) or requires an **Agent Loop** (autonomous reasoning).
3. **Agent Loop**: If complex, the agent enters a cycle of: *Think $ightarrow$ Act $ightarrow$ Observe $ightarrow$ Repeat*.

## 🚀 Getting Started

### Prerequisites
- **Node.js** (v18+)
- **OpenAI API Key**

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd browse-agent
   ```

2. **Install dependencies**
   ```bash
   npm install
   npx playwright install chromium
   ```

3. **Configure Environment**
   Create a `.env` file in the root directory:
   ```env
   OPENAI_API_KEY=your_api_key_here
   OPENAI_MODEL=gpt-4o-mini
   PORT=3456
   ```

4. **Run the application**
   ```bash
   npm run dev
   ```
   Access the UI at `http://localhost:3456`

---

### 🐳 Running with Docker (Recommended)

The project comes with a pre-configured Docker environment that handles all Playwright system dependencies.

1. **Build and run**
   ```bash
   docker-compose up --build -d
   ```

2. **Access the UI**
   Open `http://localhost:3456` in your browser.

## 🛠 API Reference

### Sessions
- `POST /sessions`: Create a new browser session.
- `GET /sessions`: List all active sessions.
- `GET /sessions/:id`: Get details of a specific session.
- `DELETE /sessions/:id`: Close and destroy a session.
- `DELETE /sessions/:id/history`: Clear the AI conversation history.

### Interaction
- `POST /sessions/:id/agent/stream`: Send a natural language prompt and receive a real-time stream of actions (SSE).
- `POST /sessions/:id/interact`: Execute a specific tool action (navigate, click, etc.) directly.

## 🛡 Technical Specifications

- **Runtime**: Node.js / TypeScript
- **Server**: Fastify
- **Browser Automation**: Playwright
- **LLM**: OpenAI GPT-4o-mini
- **State**: In-memory session management with TTL cleanup
