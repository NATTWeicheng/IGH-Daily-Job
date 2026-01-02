const express = require("express");
const router = express.Router();
const {getPage, cleanup, launchAndGoto, errorResponse, successResponse, getBrowser, retryOnTimeout } = require('../workflows/portnet.js')
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
        await launchAndGoto(process.env.PORTNET_WEBSITE);
        const page = getPage();

        // ===== PRE-LOGIN OTP CHECK =====
        let authResult = getGoogleAuthCode(process.env.GOOGLE_AUTH_CODE);
        console.log(
            `Pre-login timing check: ${authResult.code}, ${authResult.secondsRemaining}s remaining`
        );

        // If OTP is about to expire, wait for a fresh window
        if (authResult.secondsRemaining < 15) {
            const waitTime = (authResult.secondsRemaining + 2) * 1000;
            await page.waitForTimeout(waitTime);
            authResult = getGoogleAuthCode(process.env.GOOGLE_AUTH_CODE2);
        }

        // fill login details
        await page.waitForSelector('#mat-input-0', { state: 'visible', timeout: 10000 });
        await page.locator('#mat-input-0').fill(process.env.PORTNET_USER);

        await page.waitForSelector('#mat-input-1', { state: 'visible', timeout: 10000 });
        await page.locator('#mat-input-1').fill(process.env.PORTNET_PASSWORD);

        await page.locator(
            'body > app-root > app-login-page > div > mat-sidenav-container > mat-sidenav-content > div.login-form > form > div:nth-child(3) > button'
        ).click();

        // wait for 2fa 
        await page.waitForSelector('#PASSWORD', { state: 'visible', timeout: 10000 });
        console.log('2FA page loaded');

        // Generate OTP close to submission
        authResult = getGoogleAuthCode(process.env.GOOGLE_AUTH_CODE);
        console.log(
            `At 2FA page: ${authResult.code}, ${authResult.secondsRemaining}s remaining`
        );

        // ===== ENTER OTP =====
        const otpInput = page.locator('#PASSWORD');

        await otpInput.clear();
        await page.waitForTimeout(300);
        await otpInput.click();
        await page.waitForTimeout(200);
        await otpInput.fill(authResult.code);

        // Verify input
        let filledValue = await otpInput.inputValue();
        console.log(`Verification - Expected: "${authResult.code}", Actual: "${filledValue}"`);

        // Retry once if fill failed
        if (filledValue !== authResult.code) {
            console.warn('OTP fill failed, retrying...');
            await otpInput.clear();
            await page.waitForTimeout(300);
            await otpInput.type(authResult.code, { delay: 50 });

            filledValue = await otpInput.inputValue();
            console.log(`Retry verification: "${filledValue}"`);

            if (filledValue !== authResult.code) {
                throw new Error(
                    `Failed to fill 2FA code. Expected: ${authResult.code}, Got: ${filledValue}`
                );
            }
        }

        // Submit 2FA
        await page.locator('#Continue').click();
        await page.waitForTimeout(3000);

        // ===== POST-LOGIN CHECK =====
        const currentUrl = page.url();
        console.log('Current URL:', currentUrl);

        const errorCount = await page
            .locator('text=/invalid|incorrect|wrong|error/i')
            .count();

        if (errorCount > 0) {
            const errorText = await page
                .locator('text=/invalid|incorrect|wrong|error/i')
                .first()
                .textContent();
            throw new Error(`2FA Error: ${errorText}`);
        }

        return res.status(200).json(
            successResponse('fill-login-details', {
                message: 'Login and 2FA completed successfully'
            })
        );

    } catch (err) {
        console.error('Login error:', err);
        return res.status(200).json(
            errorResponse('fill-login-details', err)
        );
    }
});


// route to click on others
router.post("/click-others", async (req, res) => {
    try {
        const result = await retryOnTimeout(async (page) => {
            // Selector for "other"
            let otherSelector = 'body > app-root > div > div.slidebar > div:nth-child(8) > div'
            // Click on the button
            await page.locator(otherSelector).click()
        });

        if (!result.success) {
            return res.status(200).json(errorResponse('click-others', result.error));
        }

        res.status(200).json(successResponse('click-others'));

    } catch (err) {
        console.error(err);
        res.status(200).json(errorResponse('click-others', err));
    }
});

// route to click on supplier management
router.post("/click-supplier-management", async (req, res) => {
    try {
        const result = await retryOnTimeout(async (page) => {
            // Selector for Supplier Management Button
            let supplierManagamentSelector = 'body > app-root > div > div.main-content > app-container-group > div > div.half-width > div:nth-child(2) > div:nth-child(2) > div > div.lv2-panel > div:nth-child(5) > div.mat-mdc-menu-trigger.subheading.flex-layout'
            // Click on the button
            await page.locator(supplierManagamentSelector).click()
        });

        if (!result.success) {
            return res.status(200).json(errorResponse('click-supplier-management', result.error));
        }

        res.status(200).json(successResponse('click-supplier-management'));

    } catch (err) {
        console.error(err);
        res.status(200).json(errorResponse('click-supplier-management', err));
    }
});

// route to click on enquire job payment under payment advice
router.post("/click-enquire-invoice", async (req, res) => {
    try {
        const result = await retryOnTimeout(async (page) => {
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
        });

        if (!result.success) {
            return res.status(200).json(errorResponse('click-enquire-invoice', result.error));
        }

        res.status(200).json(successResponse('click-enquire-invoice', { message: 'Clicked Enquire Invoice' }));

    } catch (err) {
        console.error(err);
        res.status(200).json(errorResponse('click-enquire-invoice', err));
    }
});

// route to fill job payment table for daily invoice
router.post("/fill-job-payment-table", async (req, res) => {
    try {
        const { currentDate } = req.body; // Pass DD/MM/YYYY or omit

        const page = getPage();
        
        // Iframe selector
        const frameElement = await page.waitForSelector('iframe.frame__webview', { 
            state: 'attached', 
            timeout: 10000 
        });
        
        const frame = await frameElement.contentFrame();
        if (!frame) throw new Error('Could not access iframe content');

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

        // ================= DATE LOGIC =================
        let baseDate = new Date(); // default fallback

        if (currentDate && currentDate.trim() !== '') {
            const datePattern = /^\d{2}\/\d{2}\/\d{4}$/;

            if (!datePattern.test(currentDate)) {
                console.warn(`[DATE] Invalid format (expected DD/MM/YYYY): ${currentDate}`);
            } else {
                const [dd, mm, yyyy] = currentDate.split('/').map(Number);
                const parsedDate = new Date(yyyy, mm - 1, dd);

                if (isNaN(parsedDate.getTime())) {
                    console.warn(`[DATE] Invalid date value: ${currentDate}`);
                } else {
                    baseDate = parsedDate;
                }
            }
        }

        // Subtract 1 day
        baseDate.setDate(baseDate.getDate() - 1);

        const day = String(baseDate.getDate()).padStart(2, '0');
        const month = String(baseDate.getMonth() + 1).padStart(2, '0');
        const year = String(baseDate.getFullYear());

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
        await frame.locator(
            'body > form > table > tbody > tr:nth-child(8) > td > input[type=submit]:nth-child(1)'
        ).click();

        // Wait for the "Details" links to appear
        await frame.waitForSelector('a:has-text("Detail Information")', { 
            state: 'visible', 
            timeout: 10000 
        });
        await frame.waitForTimeout(1000);

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
      const filePath = path.join(process.env.DAILY_INVOICES_PATH, fileName);
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

// route to clear all files from local folder
router.delete('/delete-files', async (req, res) => {
    try {
      const downloadPath = (process.env.DAILY_INVOICES_PATH);
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