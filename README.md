# Ace AI Solver

[![Downloads](https://img.shields.io/github/downloads/ltsRoy/ace-ai-solver/total?label=downloads)](https://github.com/ltsRoy/ace-ai-solver/releases/latest)
[![Installs](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fabacus.jasoncameron.dev%2Fget%2Fltsroy-ace-ai-solver%2Finstalls&query=%24.value&label=installs&color=blue)](#usage-stats)
[![Active user-days](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fabacus.jasoncameron.dev%2Fget%2Fltsroy-ace-ai-solver%2Factive-days&query=%24.value&label=active%20user-days&color=green)](#usage-stats)
[![Problems solved](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fabacus.jasoncameron.dev%2Fget%2Fltsroy-ace-ai-solver%2Fsolved&query=%24.value&label=problems%20solved&color=orange)](#usage-stats)
[![Page views](https://hits.sh/github.com/ltsRoy/ace-ai-solver.svg?label=page%20views)](https://hits.sh/github.com/ltsRoy/ace-ai-solver/)

Edge / Chrome extension. On a page with an Ace code editor it reads the question, asks an AI
(Groq or Gemini) for a solution, pastes it into the editor, clicks **Compile & Run**, checks every
test row (Output must equal Expected Output), feeds errors back to the AI and retries, clicks
**Submit** only after a clean run, then opens the next unfinished item in the sidebar.
Quiz pages (MCQs): answers all questions in one AI request, selects them, submits, moves on.

The AI receives only the question text/images and the code, never the site's URL or name.

## Download

**[⬇ Latest release](https://github.com/ltsRoy/ace-ai-solver/releases/latest)**: download the `.zip` from there.

## Install

1. Unzip the folder somewhere permanent (don't delete it afterwards).
2. Edge: open `edge://extensions` · Chrome: open `chrome://extensions`
3. Turn on **Developer mode**.
4. Click **Load unpacked** and pick the unzipped folder.
5. Pin the extension, open its popup and enter **your own** API key:
   - Groq (free): https://console.groq.com/keys
   - Gemini (optional fallback / image questions): https://aistudio.google.com/apikey
6. Click **Save**.

## Use

Open any tab of the course and click **Solve with AI** (bottom-right). Click it again to stop.

Popup options: provider/model, max tries per question, auto submit, auto next, and
**Step delays** (seconds between steps so you can watch what happens).
Open the console (F12) for log lines starting with `[Ace Gemini]`.

After editing files: click **Reload** on the extension card, then refresh the page.

## Usage stats

The badges above are public counters. The extension adds **+1** to:

| Counter | When |
|---|---|
| installs | once, when the extension is first installed |
| active user-days | at most once per day per install, only on days it is used |
| problems solved | each time a problem/quiz passes and is submitted |

Nothing else is sent: no ID, no name, no email, no site URL, no questions or code.
Turn it off in the popup: untick **Send anonymous usage counts**.

## Extra

`test-models.ps1` checks which Gemini models your key can use right now:

```
powershell -ExecutionPolicy Bypass -File test-models.ps1
```
