const express = require("express");
const router = express.Router();
const {getPage, cleanup, launchAndGoto, errorResponse, successResponse, retryOnTimeout } = require('../workflows/portnet.js')
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
          let otherSelector = 'body > app-root > div > div.slidebar > div:nth-child(8) > div'
          await page.locator(otherSelector).click()

          // Verify: Wait for panel to be visible
          await page.waitForSelector('.lv2-panel', { state: 'visible', timeout: 5000 });
      });

      if (!result.success) {
          return res.status(200).json(errorResponse('click-others', result.error));
      }

      res.status(200).json(successResponse('click-others', { message: 'Clicked Others successfully' }));

  } catch (err) {
      console.error(err);
      res.status(200).json(errorResponse('click-others', err));
  }
});

// route to click on supplier management
router.post("/click-supplier-management", async (req, res) => {
  try {
      const result = await retryOnTimeout(async (page) => {
          let supplierManagamentSelector = 'body > app-root > div > div.main-content > app-container-group > div > div.half-width > div:nth-child(2) > div:nth-child(2) > div > div.lv2-panel > div:nth-child(5) > div.mat-mdc-menu-trigger.subheading.flex-layout'
          await page.locator(supplierManagamentSelector).click()

          // Verify: Wait for iframe to appear
          await page.waitForSelector('iframe.frame__webview', {
              state: 'visible',
              timeout: 10000
          });
      });

      if (!result.success) {
          return res.status(200).json(errorResponse('click-supplier-management', result.error));
      }

      res.status(200).json(successResponse('click-supplier-management', { message: 'Clicked Supplier Management successfully' }));

  } catch (err) {
      console.error(err);
      res.status(200).json(errorResponse('click-supplier-management', err));
  }
});

// route to click on enquire LD/NSIR invoice under payment advice
router.post("/click-enquire-invoice", async (req, res) => {
  try {
      const result = await retryOnTimeout(async (page) => {
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
      });

      if (!result.success) {
          return res.status(200).json(errorResponse('click-enquire-invoice', result.error));
      }

      res.status(200).json(successResponse('click-enquire-invoice', {
          message: 'Clicked Enquire LD/NSIR Invoice and verified form loaded'
      }));

  } catch (err) {
      console.error('click-enquire-invoice error:', err);
      res.status(200).json(errorResponse('click-enquire-invoice', err));
  }
});

// route to fill job payment table for LD only
router.post("/fill-job-payment-tableLD", async (req, res) => {
  try {
    const { currentDate } = req.body;
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
    await frame.selectOption('select[name="invoiceType"]', 'LD');

    let fromDate = new Date();
    let toDate = new Date();

    if (currentDate && /^\d{2}\/\d{2}\/\d{4}$/.test(currentDate)) {
      const [dd, mm, yyyy] = currentDate.split('/').map(Number);
      const parsed = new Date(yyyy, mm - 1, dd);
      if (!isNaN(parsed.getTime())) {
        fromDate = new Date(parsed);
        toDate = new Date(parsed);
      }
    }

    fromDate.setDate(fromDate.getDate() - 7);

    const fDD = String(fromDate.getDate()).padStart(2, '0');
    const fMM = String(fromDate.getMonth() + 1).padStart(2, '0');
    const fYYYY = String(fromDate.getFullYear());

    const tDD = String(toDate.getDate()).padStart(2, '0');
    const tMM = String(toDate.getMonth() + 1).padStart(2, '0');
    const tYYYY = String(toDate.getFullYear());

    await frame.fill('input[name="fDD"]', fDD);
    await frame.fill('input[name="fMM"]', fMM);
    await frame.fill('input[name="fYYYY"]', fYYYY);

    await frame.fill('input[name="tDD"]', tDD);
    await frame.fill('input[name="tMM"]', tMM);
    await frame.fill('input[name="tYYYY"]', tYYYY);

    await frame.locator(
      'body > form > table > tbody > tr:nth-child(7) > td > input[type=submit]:nth-child(1)'
    ).click();

    const timeout = Date.now() + 10000;
    let count = 0;
    let noRecord = false;

    while (Date.now() < timeout) {
      count = await frame.locator('a:has-text("Detail Information")').count();
      if (count > 0) break;
      if (await frame.locator('text=No record found').count()) {
        noRecord = true;
        break;
      }
      await frame.waitForTimeout(500);
    }

    res.status(200).json(successResponse('fill-job-payment-tableLD', {
      message: noRecord ? 'No job items found' : 'Search completed',
      itemCount: count,
      fromDate: `${fDD}/${fMM}/${fYYYY}`
    }));
  } catch (err) {
    console.error(err);
    res.status(200).json(errorResponse('fill-job-payment-tableLD', err));
  }
});

// route to fill job payment table for NISR
router.post("/fill-job-payment-tableNISR", async (req, res) => {
  try {
    const { currentDate } = req.body;
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
    await frame.selectOption('select[name="invoiceType"]', 'NISR');

    let fromDate = new Date();
    let toDate = new Date();

    if (currentDate && /^\d{2}\/\d{2}\/\d{4}$/.test(currentDate)) {
      const [dd, mm, yyyy] = currentDate.split('/').map(Number);
      const parsed = new Date(yyyy, mm - 1, dd);
      if (!isNaN(parsed.getTime())) {
        fromDate = new Date(parsed);
        toDate = new Date(parsed);
      }
    }

    fromDate.setDate(fromDate.getDate() - 7);

    const fDD = String(fromDate.getDate()).padStart(2, '0');
    const fMM = String(fromDate.getMonth() + 1).padStart(2, '0');
    const fYYYY = String(fromDate.getFullYear());

    const tDD = String(toDate.getDate()).padStart(2, '0');
    const tMM = String(toDate.getMonth() + 1).padStart(2, '0');
    const tYYYY = String(toDate.getFullYear());

    await frame.fill('input[name="fDD"]', fDD);
    await frame.fill('input[name="fMM"]', fMM);
    await frame.fill('input[name="fYYYY"]', fYYYY);

    await frame.fill('input[name="tDD"]', tDD);
    await frame.fill('input[name="tMM"]', tMM);
    await frame.fill('input[name="tYYYY"]', tYYYY);

    await frame.locator(
      'body > form > table > tbody > tr:nth-child(7) > td > input[type=submit]:nth-child(1)'
    ).click();

    const timeout = Date.now() + 10000;
    let count = 0;
    let noRecord = false;

    while (Date.now() < timeout) {
      count = await frame.locator('a:has-text("Detail Information")').count();
      if (count > 0) break;
      if (await frame.locator('text=No record found').count()) {
        noRecord = true;
        break;
      }
      await frame.waitForTimeout(500);
    }

    res.status(200).json(successResponse('fill-job-payment-tableNISR', {
      message: noRecord ? 'No job items found' : 'Search completed',
      itemCount: count,
      fromDate: `${fDD}/${fMM}/${fYYYY}`
    }));
  } catch (err) {
    console.error(err);
    res.status(200).json(errorResponse('fill-job-payment-tableNISR', err));
  }
});

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
    const filePath = path.join(process.env.LD_NISR_PATH, fileName);
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
    const downloadPath = (process.env.LD_NISR_PATH);
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


// route to delete all files in the local folder
router.delete('/delete-files', async (req, res) => {
  try {
    const downloadPath = (process.env.LD_NISR_PATH);
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