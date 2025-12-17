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

// route to click on enquire job payment under payment advice
router.post("/click-job-payment", async (req, res) => {
    try {
        const page = getPage();
        
        // Get the iframe
        const frameElement = await page.waitForSelector('iframe.frame__webview', { 
            state: 'attached', 
            timeout: 15000
        });
        
        await page.waitForTimeout(1000);
        
        const frame = await frameElement.contentFrame();
        
        if (!frame) {
            throw new Error('Could not access iframe content');
        }
        
        // Wait for iframe content to load
        await frame.waitForLoadState('domcontentloaded', { timeout: 10000 });
        
        // Wait for "PAYMENT MODULES" to appear in the iframe
        await frame.waitForSelector('text=PAYMENT MODULES', { 
            state: 'visible', 
            timeout: 10000 
        });
        
        // Click the link inside the iframe
        await frame.locator('a[href="/SUMS-WLS12/SUMSMainServlet?requestID=initJobPaymentEnquiryID"]').click();
        
        // Verify: Wait for the form to load
        await frame.waitForSelector('select[name="jobTy"]', { 
            state: 'visible', 
            timeout: 10000 
        });
        
        res.status(200).json(successResponse('click-job-payment', { message: 'Clicked Enquire Job Payment and verified form loaded' }));

    } catch (err) {
        console.error(err);
        res.status(200).json(errorResponse('click-job-payment', err));
    }
});

// route to select IGH from the dropdown
// DO NOT DELETE - actual current date
// router.post("/fill-job-payment-table", async (req, res) => {
//     try {
//         const page = getPage();
        
//         const frameElement = await page.waitForSelector('iframe.frame__webview', { 
//             state: 'attached', 
//             timeout: 10000 
//         });
        
//         const frame = await frameElement.contentFrame();
        
//         if (!frame) {
//             throw new Error('Could not access iframe content');
//         }
        
//         // Select job type as IGH
//         await frame.waitForSelector('select[name="jobTy"]', { 
//             state: 'visible', 
//             timeout: 10000 
//         });
        
//         await frame.waitForTimeout(500);
        
//         await frame.selectOption('select[name="jobTy"]', 'IGH');
//         await frame.waitForTimeout(500);
        
//         // Select accepted radio button
//         await frame.waitForSelector('input[name="acptI"][value="Y"]', {
//             state: 'visible',
//             timeout: 5000
//         });
//         await frame.click('input[name="acptI"][value="Y"]');
//         await frame.waitForTimeout(500);
        
//         // Date logic
//         const today = new Date();
//         const threeDaysAgo = new Date(today);
//         threeDaysAgo.setDate(today.getDate() - 3);
        
//         const day = String(threeDaysAgo.getDate()).padStart(2, '0');
//         const month = String(threeDaysAgo.getMonth() + 1).padStart(2, '0');
//         const year = String(threeDaysAgo.getFullYear());
        
//         // Fill From date
//         await frame.fill('input[name="shftDtFrDD"]', day);
//         await frame.waitForTimeout(200);
//         await frame.fill('input[name="shftDtFrMM"]', month);
//         await frame.waitForTimeout(200);
//         await frame.fill('input[name="shftDtFrYYYY"]', year);
        
//         // Fill To date
//         await frame.fill('input[name="shftDtToDD"]', day);
//         await frame.waitForTimeout(200);
//         await frame.fill('input[name="shftDtToMM"]', month);
//         await frame.waitForTimeout(200);
//         await frame.fill('input[name="shftDtToYYYY"]', year);
        
//         await frame.waitForTimeout(500);
        
//         // Click submit button
//         await frame.locator('body > form > table:nth-child(8) > tbody > tr > td > input[type=button]:nth-child(1)').click();
        
//         // Wait for the "Details" links to appear
//         await frame.waitForSelector('a:has-text("Details")', { 
//             state: 'visible', 
//             timeout: 10000 
//         });
        
//         await frame.waitForTimeout(1000);
        
//         // Get ONLY the rows with "Details" links
//         const detailsLinks = await frame.locator('a:has-text("Details")').all();
        
//         console.log(`Found ${detailsLinks.length} job items with Details links`);
        
//         res.status(200).json(successResponse('fill-job-payment-table', { 
//             message: 'Search completed',
//             itemCount: detailsLinks.length,
//             fromDate: `${day}/${month}/${year}`
//         }));

//     } catch (err) {
//         console.error(err);
//         res.status(200).json(errorResponse('fill-job-payment-table', err));
//     }
// });

router.post("/fill-job-payment-table", async (req, res) => {
    try {
        const { currentDate } = req.body; // Get currentDate from request body
        
        const page = getPage();
        
        const frameElement = await page.waitForSelector('iframe.frame__webview', { 
            state: 'attached', 
            timeout: 10000 
        });
        
        const frame = await frameElement.contentFrame();
        
        if (!frame) {
            throw new Error('Could not access iframe content');
        }
        
        // Select job type as IGH
        await frame.waitForSelector('select[name="jobTy"]', { 
            state: 'visible', 
            timeout: 10000 
        });
        
        await frame.waitForTimeout(500);
        
        await frame.selectOption('select[name="jobTy"]', 'IGH');
        await frame.waitForTimeout(500);
        
        // Select accepted radio button
        await frame.waitForSelector('input[name="acptI"][value="Y"]', {
            state: 'visible',
            timeout: 5000
        });
        await frame.click('input[name="acptI"][value="Y"]');
        await frame.waitForTimeout(500);
        
        // Date logic
        let today;
        
        if (currentDate && currentDate.trim() !== '') {
            // Validate DD/MM/YYYY format
            const datePattern = /^\d{2}\/\d{2}\/\d{4}$/;
            
            if (!datePattern.test(currentDate)) {
                throw new Error('Invalid date format. Expected DD/MM/YYYY');
            }
            
            const [day, month, year] = currentDate.split('/');
            today = new Date(year, month - 1, day);
            
            // Check if the date is valid
            if (isNaN(today.getTime())) {
                throw new Error('Invalid date provided');
            }
        } else {
            // Use actual current date
            today = new Date();
        }
        
        const threeDaysAgo = new Date(today);
        threeDaysAgo.setDate(today.getDate() - 3);
        
        const day = String(threeDaysAgo.getDate()).padStart(2, '0');
        const month = String(threeDaysAgo.getMonth() + 1).padStart(2, '0');
        const year = String(threeDaysAgo.getFullYear());
        
        // Fill From date
        await frame.fill('input[name="shftDtFrDD"]', day);
        await frame.waitForTimeout(200);
        await frame.fill('input[name="shftDtFrMM"]', month);
        await frame.waitForTimeout(200);
        await frame.fill('input[name="shftDtFrYYYY"]', year);
        
        // Fill To date
        await frame.fill('input[name="shftDtToDD"]', day);
        await frame.waitForTimeout(200);
        await frame.fill('input[name="shftDtToMM"]', month);
        await frame.waitForTimeout(200);
        await frame.fill('input[name="shftDtToYYYY"]', year);
        
        await frame.waitForTimeout(500);
        
        // Click submit button
        await frame.locator('body > form > table:nth-child(8) > tbody > tr > td > input[type=button]:nth-child(1)').click();
        
        // Wait for the "Details" links to appear
        await frame.waitForSelector('a:has-text("Details")', { 
            state: 'visible', 
            timeout: 10000 
        });
        
        await frame.waitForTimeout(1000);
        
        // Get ONLY the rows with "Details" links
        const detailsLinks = await frame.locator('a:has-text("Details")').all();
        
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

// route to click on the summary after clicking on detail
router.post("/click-summary-of-igh-moves", async (req, res) => {
    try {
        const page = getPage();
        
        const frameElement = await page.waitForSelector('iframe.frame__webview', { 
            state: 'attached', 
            timeout: 10000
        });
        
        const frame = await frameElement.contentFrame();
        
        if (!frame) {
            throw new Error('Could not access iframe content');
        }

        // Wait for the link to be visible
        await frame.waitForSelector('a:has-text("Summary of IGH Moves")', {
            state: 'visible',
            timeout: 10000
        });

        await frame.click('a:has-text("Summary of IGH Moves")');
        
        // Verify: Wait for download button to appear
        await frame.waitForSelector('input[type="submit"][value="Download To Excel"]', {
            state: 'visible',
            timeout: 10000
        });
        
        res.status(200).json(successResponse('click-summary-of-igh-moves', { 
            message: 'Successfully clicked "Summary of IGH Moves" link and verified page loaded'
        }));

    } catch (err) {
        console.error(err);
        res.status(200).json(errorResponse('click-summary-of-igh-moves', err));
    }
});

// route to download and rename excel files
router.post("/download-and-rename-excel", async (req, res) => {
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
        const downloadPath = (process.env.LOCALFILE_PATH);
        
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
        
        res.status(200).json(successResponse('download-and-rename-excel', { 
            message: 'Successfully downloaded and renamed Excel file',
            fileName: newFileName,
            filePath: filePath,
            index: index,
            fileNumber: fileNumber
        }));

    } catch (err) {
        console.error('Download error:', err);
        res.status(200).json(errorResponse('download-and-rename-excel', err));
    }
});

// route to click back button from the excel download page
router.post("/click-back-button1", async (req, res) => {
    try {
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
        
        // Click the "Back" button
        await frame.click('input[type="button"][value="Back"]');
        
        // Wait for navigation to complete
        await frame.waitForTimeout(1000);
        
        res.status(200).json(successResponse('click-back-button1', { 
            message: 'Successfully clicked Back button'
        }));

    } catch (err) {
        console.error('Back button click error:', err);
        res.status(200).json(errorResponse('click-back-button1', err));
    }
});

// route to click back button from the summary selection page
router.post("/click-back-button2", async (req, res) => {
    try {
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
        
        // Wait for navigation to complete
        await frame.waitForTimeout(1000);
        
        res.status(200).json(successResponse('click-back-button2', { 
            message: 'Successfully clicked Back button from summary page'
        }));

    } catch (err) {
        console.error('Back button click error:', err);
        res.status(200).json(errorResponse('click-back-button2', err));
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