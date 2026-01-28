/**
 * Jotform Code Editor
 * Monaco Editor integration with API client
 */

// Global state
let editor = null;
let apiClient = null;
let currentLanguage = 'python';
let isExecuting = false;
let languages = {};

// Monaco language mapping
const MONACO_LANGUAGE_MAP = {
    python: 'python',
    c: 'c',
    cpp: 'cpp',
    java: 'java',
    go: 'go',
    rust: 'rust',
    php: 'php'
};

/**
 * Initialize the application
 */
async function init() {
    apiClient = new ApiClient();

    // Load languages from API
    try {
        const response = await apiClient.getLanguages();
        languages = response.languages;
        populateLanguageSelector();
    } catch (err) {
        console.error('Failed to load languages:', err);
        showError('Failed to load language configuration');
    }

    // Initialize Monaco Editor
    require.config({
        paths: {
            'vs': 'https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs'
        }
    });

    require(['vs/editor/editor.main'], function() {
        editor = monaco.editor.create(document.getElementById('editor'), {
            value: languages[currentLanguage]?.helloWorld || '# Write your code here',
            language: MONACO_LANGUAGE_MAP[currentLanguage] || 'plaintext',
            theme: 'vs-dark',
            fontSize: 14,
            fontFamily: "'Fira Code', 'Monaco', 'Consolas', monospace",
            fontLigatures: true,
            minimap: { enabled: true },
            lineNumbers: 'on',
            roundedSelection: true,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 4,
            insertSpaces: true,
            wordWrap: 'on',
            padding: { top: 16, bottom: 16 }
        });

        // Update filename display
        updateFilename();

        // Keyboard shortcut: Ctrl/Cmd + Enter to run
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, runCode);
    });

    // Event listeners
    document.getElementById('language-select').addEventListener('change', onLanguageChange);
    document.getElementById('run-btn').addEventListener('click', runCode);
    document.getElementById('clear-btn').addEventListener('click', clearOutput);

    // Tab switching
    document.querySelectorAll('.output-tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
}

/**
 * Populate language selector from API response
 */
function populateLanguageSelector() {
    const select = document.getElementById('language-select');

    // Clear existing options safely
    while (select.firstChild) {
        select.removeChild(select.firstChild);
    }

    Object.entries(languages).forEach(([id, config]) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = config.name;
        if (id === currentLanguage) {
            option.selected = true;
        }
        select.appendChild(option);
    });
}

/**
 * Handle language change
 */
function onLanguageChange(event) {
    currentLanguage = event.target.value;
    const config = languages[currentLanguage];

    if (editor) {
        // Update Monaco language
        monaco.editor.setModelLanguage(
            editor.getModel(),
            MONACO_LANGUAGE_MAP[currentLanguage] || 'plaintext'
        );

        // Set hello world code
        if (config?.helloWorld) {
            editor.setValue(config.helloWorld);
        }

        updateFilename();
    }
}

/**
 * Update filename in editor header
 */
function updateFilename() {
    const config = languages[currentLanguage];
    const filename = config ? `main.${config.extension}` : 'main.txt';
    document.getElementById('editor-filename').textContent = filename;
}

/**
 * Run the code
 */
async function runCode() {
    if (isExecuting || !editor) return;

    const code = editor.getValue().trim();
    if (!code) {
        showError('Please enter some code to run');
        return;
    }

    isExecuting = true;
    setLoading(true);
    clearOutput();
    updateStatus('running', 'Executing...');

    try {
        const result = await apiClient.executeAndWait(currentLanguage, code, {
            pollInterval: 500,
            maxAttempts: 120,
            onStatus: (status) => {
                if (status.status === 'queued') {
                    updateStatus('running', 'Queued...');
                } else if (status.status === 'processing') {
                    updateStatus('running', 'Processing...');
                }
            }
        });

        displayResult(result);

    } catch (err) {
        showError(err.message);
        updateStatus('error', 'Failed');
    } finally {
        isExecuting = false;
        setLoading(false);
    }
}

/**
 * Display execution result
 */
function displayResult(result) {
    const stdoutEl = document.getElementById('output-stdout');
    const stderrEl = document.getElementById('output-stderr');

    // Display stdout
    if (result.stdout) {
        stdoutEl.textContent = result.stdout;
        stdoutEl.classList.remove('output-content--empty');
    } else {
        stdoutEl.textContent = 'No output';
        stdoutEl.classList.add('output-content--empty');
    }

    // Display stderr
    if (result.stderr) {
        stderrEl.textContent = result.stderr;
        stderrEl.classList.remove('output-content--empty');
        stderrEl.classList.add('output-content--error');
    } else {
        stderrEl.textContent = 'No errors';
        stderrEl.classList.add('output-content--empty');
        stderrEl.classList.remove('output-content--error');
    }

    // Update status
    const statusType = result.exitCode === 0 ? 'success' : 'error';
    let statusText = `Exit code: ${result.exitCode}`;

    if (result.executionTime) {
        statusText += ` | ${result.executionTime}ms`;
    }

    if (result.cached) {
        statusText += ' | Cached';
        showCacheBadge();
    } else {
        hideCacheBadge();
    }

    if (result.compileError) {
        statusText = 'Compilation failed';
        switchTab('stderr');
    }

    updateStatus(statusType, statusText);
}

/**
 * Show error message
 */
function showError(message) {
    const stderrEl = document.getElementById('output-stderr');
    stderrEl.textContent = message;
    stderrEl.classList.add('output-content--error');
    stderrEl.classList.remove('output-content--empty');
    switchTab('stderr');
    updateStatus('error', 'Error');
}

/**
 * Clear output panels
 */
function clearOutput() {
    const stdoutEl = document.getElementById('output-stdout');
    const stderrEl = document.getElementById('output-stderr');

    stdoutEl.textContent = 'Output will appear here...';
    stdoutEl.classList.add('output-content--empty');

    stderrEl.textContent = 'Errors will appear here...';
    stderrEl.classList.add('output-content--empty');
    stderrEl.classList.remove('output-content--error');

    hideCacheBadge();
    updateStatus('idle', 'Ready');
    switchTab('stdout');
}

/**
 * Switch output tab
 */
function switchTab(tabName) {
    document.querySelectorAll('.output-tab').forEach(tab => {
        tab.classList.toggle('output-tab--active', tab.dataset.tab === tabName);
    });

    document.querySelectorAll('.output-content').forEach(content => {
        content.style.display = content.id === `output-${tabName}` ? 'block' : 'none';
    });
}

/**
 * Update status bar
 */
function updateStatus(type, text) {
    const indicator = document.getElementById('status-indicator');
    const textEl = document.getElementById('status-text');

    indicator.className = 'status-bar__indicator';
    if (type === 'success') indicator.classList.add('status-bar__indicator--success');
    else if (type === 'error') indicator.classList.add('status-bar__indicator--error');
    else if (type === 'running') indicator.classList.add('status-bar__indicator--running');

    textEl.textContent = text;
}

/**
 * Set loading state
 */
function setLoading(loading) {
    const overlay = document.getElementById('loading-overlay');
    const runBtn = document.getElementById('run-btn');

    overlay.classList.toggle('loading-overlay--visible', loading);
    runBtn.disabled = loading;
}

/**
 * Show cache badge
 */
function showCacheBadge() {
    document.getElementById('cache-badge').style.display = 'inline-flex';
}

/**
 * Hide cache badge
 */
function hideCacheBadge() {
    document.getElementById('cache-badge').style.display = 'none';
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', init);
