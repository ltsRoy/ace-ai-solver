Ace AI Solver (v0.4.0) - Edge / Chrome extension

WHAT IT DOES
On a page with an Ace code editor it reads the question, asks an AI (Groq or Gemini) for a
solution, pastes it into the editor, clicks "Compile & Run", checks every test row
(Output must equal Expected Output), feeds errors back to the AI and retries, clicks Submit
only after a clean run, then opens the next unfinished Programming Assignment in the sidebar.
The AI receives only the question text/images and the code, never the site's URL or name.

INSTALL
1. Unzip this folder somewhere permanent (don't delete it afterwards).
2. Edge: open edge://extensions   Chrome: open chrome://extensions
3. Turn on "Developer mode".
4. Click "Load unpacked" and pick the unzipped folder.
5. Pin the extension, open its popup, and enter YOUR OWN API key:
   - Groq (free): create a key at https://console.groq.com/keys
   - Gemini (optional fallback / image questions): https://aistudio.google.com/apikey
6. Click Save.

USE
Open any tab of the course and click "Solve with AI" (bottom-right). Click it again to stop.
Popup options: provider/model, max tries per question, auto submit, auto next question,
and "Step delays" (seconds between steps so you can watch what happens).
Open the browser console (F12) to see the log lines starting with [Ace Gemini].

AFTER EDITING FILES
Click "Reload" on the extension card, then refresh the course page.

EXTRA
test-models.ps1 - checks which Gemini models your key can use right now:
  powershell -ExecutionPolicy Bypass -File test-models.ps1
