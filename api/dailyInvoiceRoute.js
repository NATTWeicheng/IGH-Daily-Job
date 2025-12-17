const express = require("express");
const router = express.Router();
const {getPage, cleanup, launchAndGoto, errorResponse, successResponse, getBrowser } = require('../workflows/portnet.js')
const {getGoogleAuthCode} = require('../googleAuthToken.js')
const path = require('path');
const fs = require('fs');

// kill chronium
router.post('/stop-chromium', async (req, res) => {
  try {
    const browser = getBrowser();
    if (browser) {
      await browser.close();
      res.status(200).json(successResponse('stop-chromium', { message: 'Browser closed successfully' }));
    } else {
      res.status(200).json(successResponse('stop-chromium', { message: 'No browser instance running' }));
    }
  } catch (error) {
    res.status(200).json(errorResponse('stop-chromium', error));
  }
}); 

// go to page
router.post("/fill-login-details", async (req, res) => {
    try {
        const result = await launchAndGoto(process.env.PORTNET_WEBSITE);
        
        const page = getPage();
        
        // Check timing BEFORE starting login
        let authResult = getGoogleAuthCode();
        console.log(`Pre-login timing check: ${authResult.code}, ${authResult.secondsRemaining}s remaining`);
        
        // If less than 15 seconds, wait for fresh code
        if (authResult.secondsRemaining < 15) {
            const waitTime = (authResult.secondsRemaining + 2) * 1000;
            await page.waitForTimeout(waitTime);
            authResult = getGoogleAuthCode();
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
            
            // Type password
            await page.locator('#PASSWORD').type(authResult.code, { delay: 50 });
            
            const retryValue = await page.locator('#PASSWORD').inputValue();
            console.log(`Retry verification: "${retryValue}"`);
            
            if (retryValue !== authResult.code) {
                throw new Error(`Failed to fill 2FA code. Expected: ${authResult.code}, Got: ${retryValue}`);
            }
        }
        
        // Click continue
        await page.locator('#Continue').click();
        
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

        return res.status(200).json(successResponse('fill-login-details', {
            message: 'Login and 2FA completed successfully'
        }));

    } catch (err) {
        console.error('Login error:', err);
        return res.status(200).json(errorResponse('fill-login-details', err));
    }
});

// route to click on others
router.post("/click-others", async (req, res) => {
    try {
        
        const page = getPage();

        // Selector for "other"
        let otherSelector = 'body > app-root > div > div.slidebar > div:nth-child(8) > div'

        // Click on the button
        await page.locator(otherSelector).click()
        res.status(200).json(successResponse('click-others'));

    } catch (err) {
        console.error(err);
        res.status(200).json(errorResponse('click-others', err));
    }
});

// route to click on supplier management
router.post("/click-supplier-management", async (req, res) => {
    try {
        
        const page = getPage();

        // Selector for Supplier Management Button
        let supplierManagamentSelector = 'body > app-root > div > div.main-content > app-container-group > div > div.half-width > div:nth-child(2) > div:nth-child(2) > div > div.lv2-panel > div:nth-child(5) > div.mat-mdc-menu-trigger.subheading.flex-layout'
        
        // Click on the button
        await page.locator(supplierManagamentSelector).click()
        res.status(200).json(successResponse('click-supplier-management'));

    } catch (err) {
        console.error(err);
        res.status(200).json(errorResponse('click-supplier-management', err));
    }
});

// route to click on enquire job payment under payment advice
router.post("/click-enquire-invoice", async (req, res) => {
    try {
        
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
        
        // Click the link inside the iframe
        await frame.locator('a[href="/SUMS-WLS12/SUMSMainServlet?requestID=initInvoiceEnqID"]').click();
        
        res.status(200).json(successResponse('click-enquire-invoice', { message: 'Clicked Enquire Invoice' }));

    } catch (err) {
        console.error(err);
        res.status(200).json(errorResponse('click-enquire-invoice', err));
    }
});

// route to select IGH from the dropdown; click accepted and fill date to 1 day ago
router.post("/fill-job-payment-table", async (req, res) => {
    try {
        
        const page = getPage();
        
        // Iframe selector
        const frameElement = await page.waitForSelector('iframe.frame__webview', { 
            state: 'attached', 
            timeout: 10000 
        });
        
        const frame = await frameElement.contentFrame();
        
        if (!frame) {
            throw new Error('Could not access iframe content');
        }
        
        // Select Job Type as IGH
        await frame.waitForSelector('select[name="jobType"]', { 
            state: 'visible', 
            timeout: 10000 
        });
        
        await frame.waitForTimeout(500);
        
        await frame.selectOption('select[name="jobType"]', 'IGH');
        await frame.waitForTimeout(500);
        
        // Check accepted radio button
        await frame.waitForSelector('input[name="accepted"][value="Y"]', {
            state: 'visible',
            timeout: 5000
        });
        await frame.click('input[name="accepted"][value="Y"]');
        await frame.waitForTimeout(500);
        
        // Date logic
        const today = new Date();
        const oneDayAgo = new Date(today);
        // Get 1 day before current date
        oneDayAgo.setDate(today.getDate() - 1);
        
        const day = String(oneDayAgo.getDate()).padStart(2, '0');
        const month = String(oneDayAgo.getMonth() + 1).padStart(2, '0');
        const year = String(oneDayAgo.getFullYear());
        
        // Fill the from section
        await frame.fill('input[name="fDD"]', day);
        await frame.waitForTimeout(200);
        await frame.fill('input[name="fMM"]', month);
        await frame.waitForTimeout(200);
        await frame.fill('input[name="fYYYY"]', year);
        
        // Fill the to section
        await frame.fill('input[name="tDD"]', day);
        await frame.waitForTimeout(200);
        await frame.fill('input[name="tMM"]', month);
        await frame.waitForTimeout(200);
        await frame.fill('input[name="tYYYY"]', year);
        
        await frame.waitForTimeout(500);
        
        // Submit button
        await frame.locator('body > form > table > tbody > tr:nth-child(8) > td > input[type=submit]:nth-child(1)').click();
        
        // Wait for the "Details" links to appear
        await frame.waitForSelector('a:has-text("Detail Information")', { 
            state: 'visible', 
            timeout: 10000 
        });
        
        await frame.waitForTimeout(1000);
        
        // Get ONLY the rows with "Details" links (the actual job rows)
        const detailsLinks = await frame.locator('a:has-text("Detail Information")').all();
        
        console.log(`Found ${detailsLinks.length} job items with Details links`);
        
        res.status(200).json(successResponse('fill-job-payment-table', { 
            message: 'Search completed',
            itemCount: detailsLinks.length,
            fromDate: `${day}/${month}/${year}`
        }));

    } catch (err) {
        console.error(err);
        res.status(200).json(errorResponse('fill-job-payment-table', err));
    }
});

// Click a specific "Details" link by index
router.post("/click-job-item", async (req, res) => {
    try {
        const { index } = req.body; // 0 = first Details, 1 = second, 2 = third
        
        
        const page = getPage();
        
        // Iframe
        const frameElement = await page.waitForSelector('iframe.frame__webview', { 
            state: 'attached', 
            timeout: 10000 
        });
        
        const frame = await frameElement.contentFrame();
        
        if (!frame) {
            throw new Error('Could not access iframe content');
        }
        
        // Wait for Details links
        await frame.waitForSelector('a:has-text("Detail Information")', { 
            state: 'visible', 
            timeout: 10000 
        });
        
        // Get all Details links
        const detailsLinks = await frame.locator('a:has-text("Detail Information")').all();
        
        if (index >= detailsLinks.length) {
            throw new Error(`Index ${index} out of range. Only ${detailsLinks.length} Details links available.`);
        }
        
        // Click the specific Details link
        await detailsLinks[index].click();
        
        await frame.waitForTimeout(2000); // Wait for the details page to load
        
        res.status(200).json(successResponse('click-job-item', { 
            message: `Clicked Details link at index ${index}`,
            index: index
        }));

    } catch (err) {
        console.error(err);
        res.status(200).json(errorResponse('click-job-item', err, { requestedIndex: req.body.index }));
    }
});

// route to download and rename pdf files
router.post("/download-and-rename-pdf", async (req, res) => {
  try {
    const { index } = req.body;
    const page = getPage();

    // Wait for iframe
    const frameElement = await page.waitForSelector("iframe.frame__webview", { state: "attached", timeout: 15000 });
    const frame = await frameElement.contentFrame();
    if (!frame) throw new Error("Unable to access iframe");

    await frame.waitForLoadState("networkidle");

    // Extract invoice number
    let invoiceNumber = `invoice_${index + 1}`;
    try {
      const text = await frame.textContent("body");
      const match = text?.match(/Invoice No\s*:?([A-Z0-9]+)/i);
      if (match) invoiceNumber = match[1].trim();
    } catch (_) {}

    const fileName = `${invoiceNumber}.pdf`;
    const filePath = path.join(process.env.LOCALFILE_PATH, fileName);
    console.log(`Saving invoice as ${fileName}`);

    // Hide header/footer and fullscreen iframe
    await page.addStyleTag({
      content: `
        app-header, app-footer { display: none !important; }
        .app__main-wrapper { display: block !important; }
        app-frame, iframe.frame__webview {
          position: fixed !important;
          inset: 0 !important;
          width: 100vw !important;
          height: 100vh !important;
          border: none !important;
        }
        body { margin: 0 !important; overflow: hidden !important; }
      `
    });

    // Generate PDF
    await page.emulateMedia({ media: "print" });
    await page.pdf({
      path: filePath,
      format: "A4",
      landscape: true,
      printBackground: true,
      scale: 0.95
    });

    // Go back for next invoice
    try {
      if (page && typeof page.isClosed === "function" && !page.isClosed()) {
        await page.goBack({ waitUntil: "load", timeout: 5000 }).catch(() => null);
        await page.waitForTimeout(100);
      }
    } catch (goBackErr) {
      console.warn("goBack failed but continuing:", goBackErr.message);
    }

    res.status(200).json({ success: true, fileName, filePath, invoiceNumber });
  } catch (err) {
    console.error("PDF generation failed:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;