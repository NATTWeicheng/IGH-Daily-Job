const express = require("express");
const router = express.Router();
const {getPage, cleanup, launchAndGoto, checkPageWithRetry} = require('../workflows/portnet.js')
const {getGoogleAuthCode} = require('../googleAuthToken.js')
const path = require('path');
const fs = require('fs');

// kill chronium
router.post('/stop-chromium', async (req, res) => {
  try {
    await cleanup();
    res.json({ success: true, message: 'Browser closed successfully' });
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

// route to click on enquire LD/NSIR invoice under payment advice
router.post("/click-enquire-invoice", async (req, res) => {
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
        // Click the link inside the iframe
        await frame.locator('a[href="/SUMS-WLS12/SUMSMainServlet?requestID=initNisrLdInvoiceEnqID"]').click();
        
        res.json({ status: 'success', message: 'Clicked Enquire LD/NSIR Invoice' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// route to select IGH from the dropdown; fill date to 1 week ago - for LD only
router.post("/fill-job-payment-tableLD", async (req, res) => {
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

    await frame.waitForSelector('select[name="invoiceType"]', {
      state: 'visible',
      timeout: 10000
    });

    await frame.waitForTimeout(500);

    await frame.selectOption('select[name="invoiceType"]', 'LD');
    await frame.waitForTimeout(500);

    // Date logic: one week ago
    const today = new Date();
    const oneWeekAgo = new Date(today);
    oneWeekAgo.setDate(today.getDate() - 7);

    const day = String(oneWeekAgo.getDate()).padStart(2, '0');
    const month = String(oneWeekAgo.getMonth() + 1).padStart(2, '0');
    const year = String(oneWeekAgo.getFullYear());

    await frame.fill('input[name="fDD"]', day);
    await frame.waitForTimeout(200);
    await frame.fill('input[name="fMM"]', month);
    await frame.waitForTimeout(200);
    await frame.fill('input[name="fYYYY"]', year);

    await frame.waitForTimeout(500);

    // submit
    await frame.locator('body > form > table > tbody > tr:nth-child(7) > td > input[type=submit]:nth-child(1)').click();

    // Wait up to timeout for either details links OR the "No record found" error text.
    const timeout = 10000; // ms
    const pollInterval = 500; // ms
    const start = Date.now();

    let detailsCount = 0;
    let noRecordDetected = false;

    while (Date.now() - start < timeout) {
      // count doesn't throw; it's safe to call repeatedly
      detailsCount = await frame.locator('a:has-text("Detail Information")').count();
      // detect the common error text shown in the HTML you pasted
      const noRecordCount = await frame.locator('text=No record found').count();

      if (detailsCount > 0) {
        break; // found results
      }

      if (noRecordCount > 0) {
        noRecordDetected = true;
        break; // explicit "no record" shown on page
      }

      // small wait before next check
      await frame.waitForTimeout(pollInterval);
    }

    // Decide response based on what we observed
    if (detailsCount > 0) {
      console.log(`Found ${detailsCount} job items with Details links`);
      return res.json({
        status: 'success',
        message: 'Search completed',
        itemCount: detailsCount,
        fromDate: `${day}/${month}/${year}`
      });
    }

    if (noRecordDetected) {
      console.log('No job items found (page shows "No record found").');
      return res.json({
        status: 'success',
        message: 'No job items found',
        itemCount: 0,
        fromDate: `${day}/${month}/${year}`
      });
    }

    // If we get here, we timed out waiting for either condition
    console.warn('Timeout waiting for search results or no-record message.');
    return res.status(504).json({
      status: 'error',
      message: 'Timeout waiting for search results',
      itemCount: 0,
      fromDate: `${day}/${month}/${year}`
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// route to select IGH from the dropdown; fill date to 1 week ago - for NSIR only
router.post("/fill-job-payment-tableNISR", async (req, res) => {
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

    await frame.waitForSelector('select[name="invoiceType"]', {
      state: 'visible',
      timeout: 10000
    });

    await frame.waitForTimeout(500);

    await frame.selectOption('select[name="invoiceType"]', 'NISR');
    await frame.waitForTimeout(500);

    // Date logic: one week ago
    const today = new Date();
    const oneWeekAgo = new Date(today);
    oneWeekAgo.setDate(today.getDate() - 7);

    const day = String(oneWeekAgo.getDate()).padStart(2, '0');
    const month = String(oneWeekAgo.getMonth() + 1).padStart(2, '0');
    const year = String(oneWeekAgo.getFullYear());

    await frame.fill('input[name="fDD"]', day);
    await frame.waitForTimeout(200);
    await frame.fill('input[name="fMM"]', month);
    await frame.waitForTimeout(200);
    await frame.fill('input[name="fYYYY"]', year);

    await frame.waitForTimeout(500);

    // submit
    await frame.locator('body > form > table > tbody > tr:nth-child(7) > td > input[type=submit]:nth-child(1)').click();

    // Wait up to timeout for either details links OR the "No record found" error text.
    const timeout = 10000; // ms
    const pollInterval = 500; // ms
    const start = Date.now();

    let detailsCount = 0;
    let noRecordDetected = false;

    while (Date.now() - start < timeout) {
      // count doesn't throw; it's safe to call repeatedly
      detailsCount = await frame.locator('a:has-text("Detail Information")').count();
      // detect the common error text shown in the HTML you pasted
      const noRecordCount = await frame.locator('text=No record found').count();

      if (detailsCount > 0) {
        break; // found results
      }

      if (noRecordCount > 0) {
        noRecordDetected = true;
        break; // explicit "no record" shown on page
      }

      // small wait before next check
      await frame.waitForTimeout(pollInterval);
    }

    // Decide response based on what we observed
    if (detailsCount > 0) {
      console.log(`Found ${detailsCount} job items with Details links`);
      return res.json({
        status: 'success',
        message: 'Search completed',
        itemCount: detailsCount,
        fromDate: `${day}/${month}/${year}`
      });
    }

    if (noRecordDetected) {
      console.log('No job items found (page shows "No record found").');
      return res.json({
        status: 'success',
        message: 'No job items found',
        itemCount: 0,
        fromDate: `${day}/${month}/${year}`
      });
    }

    // If we get here, we timed out waiting for either condition
    console.warn('Timeout waiting for search results or no-record message.');
    return res.status(504).json({
      status: 'error',
      message: 'Timeout waiting for search results',
      itemCount: 0,
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

// route to download and rename pdf files
router.post("/download-and-rename-pdf", async (req, res) => {
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
        
        await frame.waitForTimeout(500);
        
        // Extract invoice number from the page
        let invoiceNumber = 'unknown';
        try {
            // Try to find the invoice number in the iframe
            const invoiceText = await frame.textContent('body');
            const invoiceMatch = invoiceText.match(/Invoice No\s*:(\w+)/);
            
            if (invoiceMatch) {
                invoiceNumber = invoiceMatch[1].trim();
                console.log(`Found invoice number: ${invoiceNumber}`);
            } else {
                console.warn('Invoice number not found, using index-based name');
                invoiceNumber = `invoice_${index + 1}`;
            }
        } catch (extractErr) {
            console.error('Error extracting invoice number:', extractErr);
            invoiceNumber = `invoice_${index + 1}`;
        }
        
        // Use invoice number as filename
        const newFileName = `${invoiceNumber}.pdf`;
        
        console.log(`Downloading page as PDF and saving as: ${newFileName}`);
        
        // Save to file - define path
        const downloadPath = 'C:\\Intern\\Test IGH';
        const filePath = path.join(downloadPath, newFileName);
        
        // Generate PDF directly from the page
        await page.pdf({
            path: filePath,
            format: 'A4',
            printBackground: true,
            margin: {
                top: '20px',
                right: '20px',
                bottom: '20px',
                left: '20px'
            }
        });
        
        // go back to the previous page in order to download next file
        if (page && typeof page.isClosed === 'function' && !page.isClosed()) {
            try {
                await page.goBack({ waitUntil: 'load', timeout: 5000 }).catch(() => null);
                await page.waitForTimeout(100);
            } catch (goBackErr) {
                console.warn('goBack failed but continuing:', goBackErr.message);
            }
        } else {
            console.warn('Cannot goBack — page is closed or unavailable');
        }
        
        await frame.waitForTimeout(1000);
        
        res.json({ 
            status: 'success', 
            message: 'Successfully downloaded page as PDF',
            fileName: newFileName,
            filePath: filePath,
            index: index,
            invoiceNumber: invoiceNumber
        });

    } catch (err) {
        console.error('PDF download error:', err);
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// route to delete all files in the local folder
router.delete('/delete-files', async (req, res) => {
  try {
    const downloadPath = 'C:\\Intern\\Test IGH';
    const files = fs.readdirSync(downloadPath);

    for (const file of files) {
      const filePath = path.join(downloadPath, file);
      if (fs.lstatSync(filePath).isFile()) {
        fs.unlinkSync(filePath);
      }
    }

    res.status(200).json({ message: 'All files deleted successfully.' });
  } catch (error) {
    console.error('Error deleting files:', error);
    res.status(500).json({ error: 'Failed to delete files.' });
  }
});

module.exports = router;