const { chromium } = require('playwright');

let browser = null;
let context = null;
let page = null;
let lastUsedUrl = null;

// Check if there is a running browser and an open page
function isBrowserActive() {
    return browser && browser.isConnected && browser.isConnected() && page && !page.isClosed();
}

// Launch browser and navigate
async function launchAndGoto(url) {
    try {
        // Save last used URL so retry logic can relaunch
        if (url) lastUsedUrl = url;

        // If browser is already active, just navigate
        if (isBrowserActive()) {
            await page.goto(url, { waitUntil: 'networkidle' });
            return { status: 'success', message: 'Navigated to page' };
        }

        // Launch new browser
        browser = await chromium.launch({ 
            headless: false,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        context = await browser.newContext();
        page = await context.newPage();
        
        await page.goto(url, { waitUntil: 'networkidle' });
        
        return { status: 'success', message: 'Browser launched and navigated' };
    } catch (error) {
        console.error('Error in launchAndGoto:', error);
        throw error;
    }
}

// Get page instance
function getPage() {
    if (!page || page.isClosed()) {
        throw new Error('Page is not available. Please launch browser first using /fill-login-details');
    }
    return page;
}

// Get browser instance
function getBrowser() {
    if (!browser || (browser.isConnected && !browser.isConnected())) {
        return null;
    }
    return browser;
}

// Clean up and reset
async function cleanup() {
    try {
        if (page && !page.isClosed()) {
            await page.close();
        }
        if (context) {
            await context.close();
        }
        if (browser && browser.isConnected && browser.isConnected()) {
            await browser.close();
        }
    } catch (error) {
        console.error('Cleanup error:', error.message);
    } finally {
        // Reset all references
        page = null;
        context = null;
        browser = null;
        // Also clear lastUsedUrl so retry won't try a stale URL
        lastUsedUrl = null;
    }
}

// Creates a standardized error response
function errorResponse(step, error, additionalInfo = {}) {
    return {
        status: 'error',
        step: step,
        errorType: error.name || 'UnknownError',
        message: error.message || 'An error occurred',
        timestamp: new Date().toISOString(),
        ...additionalInfo
    };
}

// success route run
function successResponse(step, data = {}) {
    return {
        status: 'success',
        step: step,
        timestamp: new Date().toISOString(),
        ...data
    };
}

module.exports = { 
    getPage, 
    getBrowser, 
    launchAndGoto,
    cleanup,
    isBrowserActive,
    errorResponse,
    successResponse
};