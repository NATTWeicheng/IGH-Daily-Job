const express = require("express");
const router = express.Router();
const {getPage, getBrowser, launchAndGoto, checkPageWithRetry} = require('../workflows/portnet.js')
const {getGoogleAuthCode} = require('../googleAuthToken.js')
const path = require('path');
const fs = require('fs');

// kill chronium
router.post('/stop-chromium', async (req, res) => {
  try {
    const browser = getBrowser(); // Get the browser instance
    if (browser) {
      await browser.close();
      res.json({ success: true, message: 'Browser closed successfully' });
    } else {
      res.json({ success: false, message: 'No browser instance running' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}); 

// go to page
router.post("/fill-login-details", async (req, res) => {
    try {
        const result = await launchAndGoto(process.env.PORTNET_WEBSITE);
        await checkPageWithRetry(3);
        const page = getPage();
        
        // Check timing BEFORE starting login
        let authResult = getGoogleAuthCode();
        console.log(`Pre-login timing check: ${authResult.code}, ${authResult.secondsRemaining}s remaining`);
        
        // If less than 15 seconds, wait for fresh code BEFORE logging in
        if (authResult.secondsRemaining < 15) {
            console.log('Not enough time for login flow, waiting for fresh code window...');
            const waitTime = (authResult.secondsRemaining + 2) * 1000;
            await page.waitForTimeout(waitTime);
            authResult = getGoogleAuthCode();
            console.log(`Fresh code ready: ${authResult.code}, ${authResult.secondsRemaining}s remaining`);
        }
        
        // Fill username
        await page.waitForSelector('#mat-input-0', { state: 'visible', timeout: 10000 });
        await page.locator('#mat-input-0').fill(process.env.PORTNET_USER);
        
        // Fill password
        await page.waitForSelector('#mat-input-1', { state: 'visible', timeout: 10000 });
        await page.locator('#mat-input-1').fill(process.env.PORTNET_PASSWORD);

        // Click login
        await page.locator('body > app-root > app-login-page > div > mat-sidenav-container > mat-sidenav-content > div.login-form > form > div:nth-child(3) > button').click();
        
        // Wait for 2FA page
        await page.waitForSelector('#PASSWORD', { state: 'visible', timeout: 10000 });
        console.log('2FA page loaded');
        
        // Get current code (should still have plenty of time)
        authResult = getGoogleAuthCode();
        console.log(`At 2FA page: ${authResult.code}, ${authResult.secondsRemaining}s remaining`);
        
        // Clear field first
        await page.locator('#PASSWORD').clear();
        await page.waitForTimeout(300);
        
        // Click to focus
        await page.locator('#PASSWORD').click();
        await page.waitForTimeout(200);
        
        // Fill the code
        await page.locator('#PASSWORD').fill(authResult.code);
        
        // Verify it was actually filled
        const filledValue = await page.locator('#PASSWORD').inputValue();
        console.log(`Verification - Expected: "${authResult.code}", Actual: "${filledValue}"`);
        
        if (filledValue !== authResult.code) {
            console.warn('Fill failed, retrying...');
            
            // Retry once
            await page.locator('#PASSWORD').clear();
            await page.waitForTimeout(300);
            await page.locator('#PASSWORD').click();
            await page.waitForTimeout(200);
            
            // Try type instead of fill
            await page.locator('#PASSWORD').type(authResult.code, { delay: 50 });
            
            const retryValue = await page.locator('#PASSWORD').inputValue();
            console.log(`Retry verification: "${retryValue}"`);
            
            if (retryValue !== authResult.code) {
                throw new Error(`Failed to fill 2FA code. Expected: ${authResult.code}, Got: ${retryValue}`);
            }
        }
        
        console.log(`Submitting 2FA code: ${authResult.code}`);
        
        // Click continue
        await page.locator('#Continue').click();
        
        console.log('Waiting for response...');
        
        // Wait a bit for processing
        await page.waitForTimeout(3000);
        
        // Check current state
        const currentUrl = page.url();
        console.log('Current URL:', currentUrl);
        
        // Check for error messages first
        const errorCount = await page.locator('text=/invalid|incorrect|wrong|error/i').count();
        if (errorCount > 0) {
            const errorText = await page.locator('text=/invalid|incorrect|wrong|error/i').first().textContent();
            throw new Error(`2FA Error: ${errorText}`);
        }

    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ 
            status: 'error', 
            message: err.message 
        });
    }
});

// route to click on others
router.post("/click-others", async (req, res) => {
    try {
        await checkPageWithRetry(3);
        const page = getPage();
        let otherSelector = 'body > app-root > div > div.slidebar > div:nth-child(8) > div'
        await page.locator(otherSelector).click()
        res.status(200).send({ status: "success" });

    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// route to click on supplier management
router.post("/click-supplier-management", async (req, res) => {
    try {
        await checkPageWithRetry(3);
        const page = getPage();
        let supplierManagamentSelector = 'body > app-root > div > div.main-content > app-container-group > div > div.half-width > div:nth-child(2) > div:nth-child(2) > div > div.lv2-panel > div:nth-child(5) > div.mat-mdc-menu-trigger.subheading.flex-layout'
        await page.locator(supplierManagamentSelector).click()
        res.status(200).send({ status: "success" });

    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// route to click on enquire job payment under payment advice
router.post("/click-job-payment", async (req, res) => {
    try {
        await checkPageWithRetry(3);
        const page = getPage();
        
        // Get the iframe
        const frameElement = await page.waitForSelector('iframe.frame__webview', { 
            state: 'attached', 
            timeout: 10000 
        });
        
        const frame = await frameElement.contentFrame();
        
        if (!frame) {
            throw new Error('Could not access iframe content');
        }
        
        // Wait for "PAYMENT MODULES" to appear in the iframe
        await frame.waitForSelector('text=PAYMENT MODULES', { 
            state: 'visible', 
            timeout: 10000 
        });
        
        // Click the link inside the iframe
        await frame.locator('a[href="/SUMS-WLS12/SUMSMainServlet?requestID=initJobPaymentEnquiryID"]').click();
        
        res.json({ status: 'success', message: 'Clicked Enquire Job Payment' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// route to select IGH from the dropdown
router.post("/fill-job-payment-table", async (req, res) => {
    try {
        await checkPageWithRetry(3);
        const page = getPage();
        
        const frameElement = await page.waitForSelector('iframe.frame__webview', { 
            state: 'attached', 
            timeout: 10000 
        });
        
        const frame = await frameElement.contentFrame();
        
        if (!frame) {
            throw new Error('Could not access iframe content');
        }
        
        await frame.waitForSelector('select[name="jobTy"]', { 
            state: 'visible', 
            timeout: 10000 
        });
        
        await frame.waitForTimeout(500);
        
        await frame.selectOption('select[name="jobTy"]', 'IGH');
        await frame.waitForTimeout(500);
        
        await frame.waitForSelector('input[name="acptI"][value="Y"]', {
            state: 'visible',
            timeout: 5000
        });
        await frame.click('input[name="acptI"][value="Y"]');
        await frame.waitForTimeout(500);
        
        // Date logic
        const today = new Date();
        const threeDaysAgo = new Date(today);
        threeDaysAgo.setDate(today.getDate() - 3);
        
        const day = String(threeDaysAgo.getDate()).padStart(2, '0');
        const month = String(threeDaysAgo.getMonth() + 1).padStart(2, '0');
        const year = String(threeDaysAgo.getFullYear());
        
        await frame.fill('input[name="shftDtFrDD"]', day);
        await frame.waitForTimeout(200);
        await frame.fill('input[name="shftDtFrMM"]', month);
        await frame.waitForTimeout(200);
        await frame.fill('input[name="shftDtFrYYYY"]', year);
        
        await frame.fill('input[name="shftDtToDD"]', day);
        await frame.waitForTimeout(200);
        await frame.fill('input[name="shftDtToMM"]', month);
        await frame.waitForTimeout(200);
        await frame.fill('input[name="shftDtToYYYY"]', year);
        
        await frame.waitForTimeout(500);
        
        await frame.locator('body > form > table:nth-child(8) > tbody > tr > td > input[type=button]:nth-child(1)').click();
        
        // Wait for the "Details" links to appear
        await frame.waitForSelector('a:has-text("Details")', { 
            state: 'visible', 
            timeout: 10000 
        });
        
        await frame.waitForTimeout(1000);
        
        // Get ONLY the rows with "Details" links (the actual job rows)
        const detailsLinks = await frame.locator('a:has-text("Details")').all();
        
        console.log(`Found ${detailsLinks.length} job items with Details links`);
        
        res.json({ 
            status: 'success', 
            message: 'Search completed',
            itemCount: detailsLinks.length, // This will be 3!
            fromDate: `${day}/${month}/${year}`
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// Click a specific "Details" link by index
router.post("/click-job-item", async (req, res) => {
    try {
        const { index } = req.body; // 0 = first Details, 1 = second, 2 = third
        
        await checkPageWithRetry(3);
        const page = getPage();
        
        const frameElement = await page.waitForSelector('iframe.frame__webview', { 
            state: 'attached', 
            timeout: 10000 
        });
        
        const frame = await frameElement.contentFrame();
        
        if (!frame) {
            throw new Error('Could not access iframe content');
        }
        
        // Wait for Details links
        await frame.waitForSelector('a:has-text("Details")', { 
            state: 'visible', 
            timeout: 10000 
        });
        
        // Get all Details links
        const detailsLinks = await frame.locator('a:has-text("Details")').all();
        
        if (index >= detailsLinks.length) {
            throw new Error(`Index ${index} out of range. Only ${detailsLinks.length} Details links available.`);
        }
        
        // Click the specific Details link
        await detailsLinks[index].click();
        
        await frame.waitForTimeout(2000); // Wait for the details page to load
        
        res.json({ 
            status: 'success', 
            message: `Clicked Details link at index ${index}`,
            index: index
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: err.message });
    }
});


// route to click on the summary after clicking on detail
router.post("/click-summary-of-igh-moves", async (req, res) => {
    try {
        await checkPageWithRetry(3);
        const page = getPage();
        
        const frameElement = await page.waitForSelector('iframe.frame__webview', { 
            state: 'attached', 
            timeout: 1500 
        });
        
        const frame = await frameElement.contentFrame();
        
        if (!frame) {
            throw new Error('Could not access iframe content');
        }

        await frame.click('a:has-text("Summary of IGH Moves")');
        
        res.json({ 
            status: 'success', 
            message: 'Successfully clicked "Summary of IGH Moves" link'
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// route to download and rename excel files
router.post("/download-and-rename-excel", async (req, res) => {
    try {
        const { index } = req.body; // Get index from request (0, 1, 2)
        
        await checkPageWithRetry(3);
        const page = getPage();
        
        const frameElement = await page.waitForSelector('iframe.frame__webview', { 
            state: 'attached', 
            timeout: 10000 
        });
        
        const frame = await frameElement.contentFrame();
        
        if (!frame) {
            throw new Error('Could not access iframe content');
        }
        
        // Wait for the "Download To Excel" button to be visible
        await frame.waitForSelector('input[type="submit"][value="Download To Excel"]', { 
            state: 'visible', 
            timeout: 10000 
        });
        
        await frame.waitForTimeout(500);
        
        // Get current date in Singapore timezone
        const now = new Date();
        const singaporeNow = new Date(now.toLocaleString('en-US', { 
            timeZone: 'Asia/Singapore'
        }));
        
        // Subtract 3 days
        singaporeNow.setDate(singaporeNow.getDate() - 3);
        
        // Format date (DD MMM format)
        const day = String(singaporeNow.getDate()).padStart(2, '0');
        const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 
                           'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
        const month = monthNames[singaporeNow.getMonth()];
        
        // Create filename: DD MMM #
        const fileNumber = index + 1;
        const newFileName = `${day} ${month} ${fileNumber}.xls`;
        
        console.log(`Downloading Excel file and renaming to: ${newFileName}`);
        
        // Save to file - define path
        const downloadPath = 'C:\\Intern\\Test IGH';
        
        // Set up download listener on the PAGE (not frame)
        const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
        
        // Click the "Download To Excel" button
        await frame.locator('input[type="submit"][value="Download To Excel"]').click();
        
        console.log('Waiting for download to start...');
        
        // Wait for download to start
        const download = await downloadPromise;
        
        console.log('Download started, saving file...');
        
        // Save the file with the new name
        const filePath = path.join(downloadPath, newFileName);
        await download.saveAs(filePath);
        
        console.log(`File saved as: ${filePath}`);
        
        await frame.waitForTimeout(1000);
        
        res.json({ 
            status: 'success', 
            message: 'Successfully downloaded and renamed Excel file',
            fileName: newFileName,
            filePath: filePath,
            index: index,
            fileNumber: fileNumber
        });

    } catch (err) {
        console.error('Download error:', err);
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// route to click back button from the excel download page
router.post("/click-back-button1", async (req, res) => {
    try {
        await checkPageWithRetry(3);
        const page = getPage();
        
        const frameElement = await page.waitForSelector('iframe.frame__webview', { 
            state: 'attached', 
            timeout: 10000 
        });
        
        const frame = await frameElement.contentFrame();
        
        if (!frame) {
            throw new Error('Could not access iframe content');
        }
        
        // Wait for the "Back" button to be visible
        await frame.waitForSelector('input[type="button"][value="Back"]', { 
            state: 'visible', 
            timeout: 10000 
        });
        
        await frame.waitForTimeout(500);
        
        console.log('Clicking Back button...');
        
        // Click the "Back" button
        await frame.click('input[type="button"][value="Back"]');
        
        console.log('Back button clicked successfully');
        
        // Wait for navigation to complete
        await frame.waitForTimeout(1000);
        
        res.json({ 
            status: 'success', 
            message: 'Successfully clicked Back button'
        });

    } catch (err) {
        console.error('Back button click error:', err);
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// route to click back button from the summary selection page
router.post("/click-back-button2", async (req, res) => {
    try {
        await checkPageWithRetry(3);
        const page = getPage();
        
        const frameElement = await page.waitForSelector('iframe.frame__webview', { 
            state: 'attached', 
            timeout: 10000 
        });
        
        const frame = await frameElement.contentFrame();
        
        if (!frame) {
            throw new Error('Could not access iframe content');
        }
        
        // Wait for the "Back" submit button to be visible
        await frame.waitForSelector('input[type="submit"][value="Back"]', { 
            state: 'visible', 
            timeout: 10000 
        });
        
        await frame.waitForTimeout(500);
        
        console.log('Clicking Back button from summary page...');
        
        // Click the "Back" submit button
        await frame.click('input[type="submit"][value="Back"]');
        
        console.log('Back button clicked successfully');
        
        // Wait for navigation to complete
        await frame.waitForTimeout(1000);
        
        res.json({ 
            status: 'success', 
            message: 'Successfully clicked Back button from summary page'
        });

    } catch (err) {
        console.error('Back button click error:', err);
        res.status(500).json({ status: 'error', message: err.message });
    }
});

module.exports = router;