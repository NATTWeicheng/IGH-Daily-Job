const { chromium } = require('playwright');

let browser = null;
let context = null;
let page = null;

// Check if browser is active
function isBrowserActive() {
    return browser && browser.isConnected() && page && !page.isClosed();
}

// Launch browser and navigate
async function launchAndGoto(url) {
    try {
        // If browser is already active, just navigate
        if (isBrowserActive()) {
            console.log('Browser already running, navigating to:', url);
            await page.goto(url, { waitUntil: 'networkidle' });
            return { status: 'success', message: 'Navigated to page' };
        }

        // Launch new browser
        console.log('Launching new browser...');
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

// Get page instance (with validation)
function getPage() {
    if (!page || page.isClosed()) {
        throw new Error('Page is not available. Please launch browser first using /fill-login-details');
    }
    return page;
}

// Get browser instance (with validation)
function getBrowser() {
    if (!browser || !browser.isConnected()) {
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
        if (browser && browser.isConnected()) {
            await browser.close();
        }
    } catch (error) {
        console.error('Cleanup error:', error.message);
    } finally {
        // Reset all references
        page = null;
        context = null;
        browser = null;
    }
}

module.exports = { 
    getPage, 
    getBrowser, 
    launchAndGoto,
    cleanup,
    isBrowserActive
};