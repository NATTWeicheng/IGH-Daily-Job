const express = require("express");
const router = express.Router();
const {getPage, cleanup, launchAndGoto, errorResponse, successResponse } = require('../workflows/portnet.js')
const {getGoogleAuthCode} = require('../googleAuthToken.js')
const path = require('path');
const fs = require('fs');

// kill chronium
router.post('/stop-chromium', async (req, res) => {
  try {
    await cleanup();
    res.status(200).json(successResponse('stop-chromium', { message: 'Browser closed successfully' }));
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
        let otherSelector = 'body > app-root > div > div.slidebar > div:nth-child(8) > div'
        await page.locator(otherSelector).click()
        
        // Verify: Wait for panel to be visible
        await page.waitForSelector('.lv2-panel', { state: 'visible', timeout: 5000 });
        
        res.status(200).json(successResponse('click-others', { message: 'Clicked Others successfully' }));

    } catch (err) {
        console.error(err);
        res.status(200).json(errorResponse('click-others', err));
    }
});

// route to click on supplier management
router.post("/click-supplier-management", async (req, res) => {
    try {
        const page = getPage();
        let supplierManagamentSelector = 'body > app-root > div > div.main-content > app-container-group > div > div.half-width > div:nth-child(2) > div:nth-child(2) > div > div.lv2-panel > div:nth-child(5) > div.mat-mdc-menu-trigger.subheading.flex-layout'
        await page.locator(supplierManagamentSelector).click()
        
        // Verify: Wait for iframe to appear
        await page.waitForSelector('iframe.frame__webview', { 
            state: 'visible', 
            timeout: 10000 
        });
        
        res.status(200).json(successResponse('click-supplier-management', { message: 'Clicked Supplier Management successfully' }));

    } catch (err) {
        console.error(err);
        res.status(200).json(errorResponse('click-supplier-management', err));
    }
});

// route to click on enquire LD/NSIR invoice under payment advice
router.post("/click-enquire-invoice", async (req, res) => {
    try {
        const page = getPage();
        
        // Wait for iframe
        const frameElement = await page.waitForSelector('iframe.frame__webview', { 
            state: 'attached', 
            timeout: 15000
        });
        
        // Wait for iframe to be ready
        await page.waitForTimeout(1000);
        
        const frame = await frameElement.contentFrame();
        
        if (!frame) {
            throw new Error('Could not access iframe content');
        }
        
        // Wait for iframe content to load
        await frame.waitForLoadState('domcontentloaded', { timeout: 10000 });
        
        // Wait for link to be visible
        await frame.waitForSelector('a[href="/SUMS-WLS12/SUMSMainServlet?requestID=initNisrLdInvoiceEnqID"]', {
            state: 'visible',
            timeout: 10000
        });
        
        // Click the link
        await frame.locator('a[href="/SUMS-WLS12/SUMSMainServlet?requestID=initNisrLdInvoiceEnqID"]').click();
        
        // Verify next page loaded
        await frame.waitForSelector('select[name="invoiceType"]', { 
            state: 'visible', 
            timeout: 10000 
        });
        
        res.status(200).json(successResponse('click-enquire-invoice', { 
            message: 'Clicked Enquire LD/NSIR Invoice and verified form loaded'
        }));

    } catch (err) {
        console.error('click-enquire-invoice error:', err);
        res.status(200).json(errorResponse('click-enquire-invoice', err));
    }
});

// route to select IGH from the dropdown; fill date to 1 week ago - for LD only
// do not delete
// router.post("/fill-job-payment-tableLD", async (req, res) => {
//   try {
//     const page = getPage();

//     const frameElement = await page.waitForSelector('iframe.frame__webview', {
//       state: 'attached',
//       timeout: 10000
//     });

//     const frame = await frameElement.contentFrame();

//     if (!frame) {
//       throw new Error('Could not access iframe content');
//     }

//     await frame.waitForSelector('select[name="invoiceType"]', {
//       state: 'visible',
//       timeout: 10000
//     });

//     await frame.waitForTimeout(500);

//     await frame.selectOption('select[name="invoiceType"]', 'LD');
//     await frame.waitForTimeout(500);

//     // Date logic: one week ago
//     const today = new Date();
//     const oneWeekAgo = new Date(today);
//     oneWeekAgo.setDate(today.getDate() - 7);

//     const day = String(oneWeekAgo.getDate()).padStart(2, '0');
//     const month = String(oneWeekAgo.getMonth() + 1).padStart(2, '0');
//     const year = String(oneWeekAgo.getFullYear());

//     await frame.fill('input[name="fDD"]', day);
//     await frame.waitForTimeout(200);
//     await frame.fill('input[name="fMM"]', month);
//     await frame.waitForTimeout(200);
//     await frame.fill('input[name="fYYYY"]', year);

//     await frame.waitForTimeout(500);

//     // submit
//     await frame.locator('body > form > table > tbody > tr:nth-child(7) > td > input[type=submit]:nth-child(1)').click();

//     // Wait up to timeout for either details links OR the "No record found" error text.
//     const timeout = 10000;
//     const pollInterval = 500;
//     const start = Date.now();

//     let detailsCount = 0;
//     let noRecordDetected = false;

//     while (Date.now() - start < timeout) {
//       detailsCount = await frame.locator('a:has-text("Detail Information")').count();
//       const noRecordCount = await frame.locator('text=No record found').count();

//       if (detailsCount > 0) {
//         break;
//       }

//       if (noRecordCount > 0) {
//         noRecordDetected = true;
//         break;
//       }

//       await frame.waitForTimeout(pollInterval);
//     }

//     if (detailsCount > 0) {
//       console.log(`Found ${detailsCount} job items with Details links`);
//       return res.status(200).json(successResponse('fill-job-payment-tableLD', {
//         message: 'Search completed',
//         itemCount: detailsCount,
//         fromDate: `${day}/${month}/${year}`
//       }));
//     }

//     if (noRecordDetected) {
//       console.log('No job items found (page shows "No record found").');
//       return res.status(200).json(successResponse('fill-job-payment-tableLD', {
//         message: 'No job items found',
//         itemCount: 0,
//         fromDate: `${day}/${month}/${year}`
//       }));
//     }

//     console.warn('Timeout waiting for search results or no-record message.');
//     throw new Error('Timeout waiting for search results');
//   } catch (err) {
//     console.error(err);
//     res.status(200).json(errorResponse('fill-job-payment-tableLD', err));
//   }
// });

// route to select IGH from the dropdown; fill date to 1 week ago - for NSIR only
// do not delete
// router.post("/fill-job-payment-tableNISR", async (req, res) => {
//   try {
//     const page = getPage();

//     const frameElement = await page.waitForSelector('iframe.frame__webview', {
//       state: 'attached',
//       timeout: 10000
//     });

//     const frame = await frameElement.contentFrame();

//     if (!frame) {
//       throw new Error('Could not access iframe content');
//     }

//     await frame.waitForSelector('select[name="invoiceType"]', {
//       state: 'visible',
//       timeout: 10000
//     });

//     await frame.waitForTimeout(500);

//     await frame.selectOption('select[name="invoiceType"]', 'NISR');
//     await frame.waitForTimeout(500);

//     // Date logic: one week ago
//     const today = new Date();
//     const oneWeekAgo = new Date(today);
//     oneWeekAgo.setDate(today.getDate() - 7);

//     const day = String(oneWeekAgo.getDate()).padStart(2, '0');
//     const month = String(oneWeekAgo.getMonth() + 1).padStart(2, '0');
//     const year = String(oneWeekAgo.getFullYear());

//     await frame.fill('input[name="fDD"]', day);
//     await frame.waitForTimeout(200);
//     await frame.fill('input[name="fMM"]', month);
//     await frame.waitForTimeout(200);
//     await frame.fill('input[name="fYYYY"]', year);

//     await frame.waitForTimeout(500);

//     // submit
//     await frame.locator('body > form > table > tbody > tr:nth-child(7) > td > input[type=submit]:nth-child(1)').click();

//     const timeout = 10000;
//     const pollInterval = 500;
//     const start = Date.now();

//     let detailsCount = 0;
//     let noRecordDetected = false;

//     while (Date.now() - start < timeout) {
//       detailsCount = await frame.locator('a:has-text("Detail Information")').count();
//       const noRecordCount = await frame.locator('text=No record found').count();

//       if (detailsCount > 0) {
//         break;
//       }

//       if (noRecordCount > 0) {
//         noRecordDetected = true;
//         break;
//       }

//       await frame.waitForTimeout(pollInterval);
//     }

//     if (detailsCount > 0) {
//       console.log(`Found ${detailsCount} job items with Details links`);
//       return res.status(200).json(successResponse('fill-job-payment-tableNISR', {
//         message: 'Search completed',
//         itemCount: detailsCount,
//         fromDate: `${day}/${month}/${year}`
//       }));
//     }

//     if (noRecordDetected) {
//       console.log('No job items found (page shows "No record found").');
//       return res.status(200).json(successResponse('fill-job-payment-tableNISR', {
//         message: 'No job items found',
//         itemCount: 0,
//         fromDate: `${day}/${month}/${year}`
//       }));
//     }

//     console.warn('Timeout waiting for search results or no-record message.');
//     throw new Error('Timeout waiting for search results');
//   } catch (err) {
//     console.error(err);
//     res.status(200).json(errorResponse('fill-job-payment-tableNISR', err));
//   }
// });


// route to select IGH from the dropdown; fill date to 1 week ago - for LD only
// do not delete
router.post("/fill-job-payment-tableLD", async (req, res) => {
  try {
    const { currentDate } = req.body; // Pass DD/MM/YYYY or omit
    const page = getPage();

    const frameElement = await page.waitForSelector('iframe.frame__webview', {
      state: 'attached',
      timeout: 10000
    });

    const frame = await frameElement.contentFrame();
    if (!frame) throw new Error('Could not access iframe content');

    await frame.waitForSelector('select[name="invoiceType"]', {
      state: 'visible',
      timeout: 10000
    });
    await frame.waitForTimeout(500);
    await frame.selectOption('select[name="invoiceType"]', 'LD');
    await frame.waitForTimeout(500);

    // ===== DATE LOGIC WITH VALIDATION =====
    let baseDate;
    let toBaseDate;
    
    if (currentDate && currentDate.trim() !== '') {
      // Validate DD/MM/YYYY format
      const datePattern = /^\d{2}\/\d{2}\/\d{4}$/;
      
      if (datePattern.test(currentDate)) {
        const [dd, mm, yyyy] = currentDate.split('/').map(Number);
        const parsedDate = new Date(yyyy, mm - 1, dd);
        
        // Check if the date is valid
        if (!isNaN(parsedDate.getTime())) {
          baseDate = new Date(yyyy, mm - 1, dd);
          toBaseDate = new Date(yyyy, mm - 1, dd);
        }
      }
    }
    
    // If baseDate wasn't set, use current date
    if (!baseDate) {
      baseDate = new Date();
      toBaseDate = new Date();
    }

    // Subtract 7 days for from date, 0 days for to date
    baseDate.setDate(baseDate.getDate() - 7);
    toBaseDate.setDate(toBaseDate.getDate() - 0);

    const day = String(baseDate.getDate()).padStart(2, '0');
    const month = String(baseDate.getMonth() + 1).padStart(2, '0');
    const year = String(baseDate.getFullYear());

    const new2day = String(toBaseDate.getDate()).padStart(2, '0');
    const new2month = String(toBaseDate.getMonth() + 1).padStart(2, '0');
    const new2year = String(toBaseDate.getFullYear());

    await frame.fill('input[name="fDD"]', day);
    await frame.waitForTimeout(200);
    await frame.fill('input[name="fMM"]', month);
    await frame.waitForTimeout(200);
    await frame.fill('input[name="fYYYY"]', year);

    await frame.fill('input[name="tDD"]', new2day);
    await frame.waitForTimeout(200);
    await frame.fill('input[name="tMM"]', new2month);
    await frame.waitForTimeout(200);
    await frame.fill('input[name="tYYYY"]', new2year);

    await frame.waitForTimeout(500);
    // submit
    await frame.locator('body > form > table > tbody > tr:nth-child(7) > td > input[type=submit]:nth-child(1)').click();

    // Wait up to timeout for either details links OR the "No record found" error text.
    const timeout = 10000;
    const pollInterval = 500;
    const start = Date.now();

    let detailsCount = 0;
    let noRecordDetected = false;

    while (Date.now() - start < timeout) {
      detailsCount = await frame.locator('a:has-text("Detail Information")').count();
      const noRecordCount = await frame.locator('text=No record found').count();

      if (detailsCount > 0) break;
      if (noRecordCount > 0) {
        noRecordDetected = true;
        break;
      }
      await frame.waitForTimeout(pollInterval);
    }

    if (detailsCount > 0) {
      console.log(`Found ${detailsCount} job items with Details links`);
      return res.status(200).json(successResponse('fill-job-payment-tableLD', {
        message: 'Search completed',
        itemCount: detailsCount,
        fromDate: `${day}/${month}/${year}`
      }));
    }

    if (noRecordDetected) {
      console.log('No job items found (page shows "No record found").');
      return res.status(200).json(successResponse('fill-job-payment-tableLD', {
        message: 'No job items found',
        itemCount: 0,
        fromDate: `${day}/${month}/${year}`
      }));
    }

    console.warn('Timeout waiting for search results or no-record message.');
    throw new Error('Timeout waiting for search results');
  } catch (err) {
    console.error(err);
    res.status(200).json(errorResponse('fill-job-payment-tableLD', err));
  }
});

// route to select IGH from the dropdown; fill date to 1 week ago - for NSIR only
// do not delete
router.post("/fill-job-payment-tableNISR", async (req, res) => {
  try {
    const { currentDate } = req.body; // Pass DD/MM/YYYY or omit
    const page = getPage();

    const frameElement = await page.waitForSelector('iframe.frame__webview', {
      state: 'attached',
      timeout: 10000
    });

    const frame = await frameElement.contentFrame();
    if (!frame) throw new Error('Could not access iframe content');

    await frame.waitForSelector('select[name="invoiceType"]', {
      state: 'visible',
      timeout: 10000
    });
    await frame.waitForTimeout(500);
    await frame.selectOption('select[name="invoiceType"]', 'NISR');
    await frame.waitForTimeout(500);

    // ===== DATE LOGIC WITH VALIDATION =====
    let baseDate;
    let toBaseDate;
    
    if (currentDate && currentDate.trim() !== '') {
      // Validate DD/MM/YYYY format
      const datePattern = /^\d{2}\/\d{2}\/\d{4}$/;
      
      if (datePattern.test(currentDate)) {
        const [dd, mm, yyyy] = currentDate.split('/').map(Number);
        const parsedDate = new Date(yyyy, mm - 1, dd);
        
        // Check if the date is valid
        if (!isNaN(parsedDate.getTime())) {
          baseDate = new Date(yyyy, mm - 1, dd);
          toBaseDate = new Date(yyyy, mm - 1, dd);
        }
      }
    }
    
    // If baseDate wasn't set, use current date
    if (!baseDate) {
      baseDate = new Date();
      toBaseDate = new Date();
    }

    // Subtract 7 days for from date, 0 days for to date
    baseDate.setDate(baseDate.getDate() - 7);
    toBaseDate.setDate(toBaseDate.getDate() - 0);

    const day = String(baseDate.getDate()).padStart(2, '0');
    const month = String(baseDate.getMonth() + 1).padStart(2, '0');
    const year = String(baseDate.getFullYear());

    const new2day = String(toBaseDate.getDate()).padStart(2, '0');
    const new2month = String(toBaseDate.getMonth() + 1).padStart(2, '0');
    const new2year = String(toBaseDate.getFullYear());

    await frame.fill('input[name="fDD"]', day);
    await frame.waitForTimeout(200);
    await frame.fill('input[name="fMM"]', month);
    await frame.waitForTimeout(200);
    await frame.fill('input[name="fYYYY"]', year);
    await frame.waitForTimeout(500);

    await frame.fill('input[name="tDD"]', new2day);
    await frame.waitForTimeout(200);
    await frame.fill('input[name="tMM"]', new2month);
    await frame.waitForTimeout(200);
    await frame.fill('input[name="tYYYY"]', new2year);

    // submit
    await frame.locator('body > form > table > tbody > tr:nth-child(7) > td > input[type=submit]:nth-child(1)').click();

    const timeout = 10000;
    const pollInterval = 500;
    const start = Date.now();

    let detailsCount = 0;
    let noRecordDetected = false;

    while (Date.now() - start < timeout) {
      detailsCount = await frame.locator('a:has-text("Detail Information")').count();
      const noRecordCount = await frame.locator('text=No record found').count();

      if (detailsCount > 0) break;
      if (noRecordCount > 0) {
        noRecordDetected = true;
        break;
      }
      await frame.waitForTimeout(pollInterval);
    }

    if (detailsCount > 0) {
      console.log(`Found ${detailsCount} job items with Details links`);
      return res.status(200).json(successResponse('fill-job-payment-tableNISR', {
        message: 'Search completed',
        itemCount: detailsCount,
        fromDate: `${day}/${month}/${year}`
      }));
    }

    if (noRecordDetected) {
      console.log('No job items found (page shows "No record found").');
      return res.status(200).json(successResponse('fill-job-payment-tableNISR', {
        message: 'No job items found',
        itemCount: 0,
        fromDate: `${day}/${month}/${year}`
      }));
    }

    console.warn('Timeout waiting for search results or no-record message.');
    throw new Error('Timeout waiting for search results');
  } catch (err) {
    console.error(err);
    res.status(200).json(errorResponse('fill-job-payment-tableNISR', err));
  }
});


// Click a specific "Details" link by index
router.post("/click-job-item", async (req, res) => {
    try {
        const { index } = req.body;
        
        const page = getPage();
        
        const frameElement = await page.waitForSelector('iframe.frame__webview', { 
            state: 'attached', 
            timeout: 10000 
        });
        
        const frame = await frameElement.contentFrame();
        
        if (!frame) {
            throw new Error('Could not access iframe content');
        }
        
        await frame.waitForSelector('a:has-text("Detail Information")', { 
            state: 'visible', 
            timeout: 10000 
        });
        
        const detailsLinks = await frame.locator('a:has-text("Detail Information")').all();
        
        if (index >= detailsLinks.length) {
            throw new Error(`Index ${index} out of range. Only ${detailsLinks.length} Details links available.`);
        }
        
        await detailsLinks[index].click();
        await frame.waitForTimeout(2000);
        
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

// route to delete all files in the local folder
router.delete('/delete-files', async (req, res) => {
  try {
    const downloadPath = (process.env.LOCALFILE_PATH);
    const files = fs.readdirSync(downloadPath);

    for (const file of files) {
      const filePath = path.join(downloadPath, file);
      if (fs.lstatSync(filePath).isFile()) {
        fs.unlinkSync(filePath);
      }
    }

    res.status(200).json(successResponse('delete-files', { message: 'All files deleted successfully.' }));
  } catch (error) {
    console.error('Error deleting files:', error);
    res.status(200).json(errorResponse('delete-files', error));
  }
});

module.exports = router;