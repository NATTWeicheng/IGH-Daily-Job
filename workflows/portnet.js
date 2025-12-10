const { chromium } = require('playwright');

let browser = null;
let context = null;
let page = null;
let lastUsedUrl = null;

// Check if browser is active
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

function setLastUsedUrl(url) {
    lastUsedUrl = url;
}

// Check if page is responsive / not frozen
// This runs a tiny evaluation and races with a timeout.
async function isPageResponsive(timeoutMs = 2000) {
    if (!page || page.isClosed()) {
        return { ok: false, reason: 'Page is not available' };
    }

    try {
        await Promise.race([
            page.evaluate(() => true),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Page timeout')), timeoutMs))
        ]);
        return { ok: true };
    } catch (err) {
        return { ok: false, reason: err.message || 'Page unresponsive' };
    }
}

// Automatically detect frozen page, cleanup, relaunch, and retry.
async function checkPageWithRetry(maxRetries = 3, delayMs = 1000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {

        const status = await isPageResponsive();

        if (status.ok) {
            return true; // Page is working
        }

        console.warn(
            `⚠ Page unresponsive (Attempt ${attempt}/${maxRetries}) – Reason: ${status.reason}`
        );

        // Cleanup frozen browser/page
        await cleanup();

        if (!lastUsedUrl) {
            throw new Error("Page is dead and no lastUsedUrl was set to relaunch.");
        }

        // Delay before retrying
        await new Promise(res => setTimeout(res, delayMs));

        console.log(`🔄 Relaunching browser and navigating to ${lastUsedUrl}...`);
        await launchAndGoto(lastUsedUrl);
    }

    throw new Error(`Page unresponsive after ${maxRetries} retries.`);
}

module.exports = { 
    getPage, 
    getBrowser, 
    launchAndGoto,
    cleanup,
    isBrowserActive,
    isPageResponsive,
    setLastUsedUrl,
    checkPageWithRetry
};
