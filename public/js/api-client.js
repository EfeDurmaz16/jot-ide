/**
 * Jotform Code Executor API Client
 */
class ApiClient {
    constructor(baseUrl = '') {
        this.baseUrl = baseUrl || window.location.origin;
    }

    /**
     * Execute code
     * @param {string} language - Programming language
     * @param {string} code - Source code to execute
     * @returns {Promise<Object>} - Response with jobId or cached result
     */
    async execute(language, code) {
        const response = await fetch(`${this.baseUrl}/api/execute.php`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ language, code }),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Execution failed');
        }

        return data;
    }

    /**
     * Get job status/result
     * @param {string} jobId - Job ID to check
     * @returns {Promise<Object>} - Job status and result
     */
    async getStatus(jobId) {
        const response = await fetch(`${this.baseUrl}/api/status.php?jobId=${encodeURIComponent(jobId)}`);

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to get status');
        }

        return data;
    }

    /**
     * Get supported languages
     * @returns {Promise<Object>} - Languages configuration
     */
    async getLanguages() {
        const response = await fetch(`${this.baseUrl}/api/languages.php`);

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to get languages');
        }

        return data;
    }

    /**
     * Execute code and poll for result
     * @param {string} language - Programming language
     * @param {string} code - Source code
     * @param {Object} options - Options
     * @param {number} options.pollInterval - Polling interval in ms (default: 500)
     * @param {number} options.maxAttempts - Max polling attempts (default: 120)
     * @param {Function} options.onStatus - Status callback
     * @returns {Promise<Object>} - Execution result
     */
    async executeAndWait(language, code, options = {}) {
        const {
            pollInterval = 500,
            maxAttempts = 120,
            onStatus = () => {}
        } = options;

        // Submit execution request
        const submitResult = await this.execute(language, code);

        // If cached, return immediately
        if (submitResult.cached && submitResult.result) {
            onStatus({ status: 'completed', cached: true });
            return {
                ...submitResult.result,
                cached: true
            };
        }

        const { jobId } = submitResult;
        onStatus({ status: 'queued', jobId });

        // Poll for result
        let attempts = 0;

        while (attempts < maxAttempts) {
            await this.sleep(pollInterval);
            attempts++;

            try {
                const statusResult = await this.getStatus(jobId);

                if (statusResult.status === 'completed' && statusResult.result) {
                    onStatus({ status: 'completed', jobId });
                    return {
                        ...statusResult.result,
                        cached: false
                    };
                }

                onStatus({ status: statusResult.status, jobId, attempt: attempts });

            } catch (err) {
                // Continue polling on transient errors
                if (attempts >= maxAttempts) {
                    throw err;
                }
            }
        }

        throw new Error('Execution timeout - result not available');
    }

    /**
     * Sleep helper
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ApiClient;
}
