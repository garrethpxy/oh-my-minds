import * as Util from './services.js';
import { google } from 'googleapis';
import 'dotenv/config';

const baseURL = process.env.BASE_URL;
const username = process.env.API_USERNAME;
const password = process.env.API_PASSWORD;
const keyFilePath = process.env.GAUTH_KEY_FILE_PATH;
const spreadsheetId = process.env.SPREADSHEET_ID; 
const sheetToJobIdMapping = process.env.GSHEET_TO_JOB_MAPPING ? JSON.parse(process.env.GSHEET_TO_JOB_MAPPING) : {}  

const getSheetsClient = () => {

  // Load the service account key JSON file.
  const auth = new google.auth.GoogleAuth({
    keyFile: keyFilePath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  // Create client instance for auth
  const sheets = google.sheets({ version: 'v4', auth });

  return sheets;
};

const spreadsheetExists = async (sheets, spreadsheetId) => {
  try {
    await sheets.spreadsheets.get({
      spreadsheetId,
    });
    // If the request succeeds, the spreadsheet exists
    return true;
  } catch (error) {
    if (error.code === 404) {
      // Spreadsheet not found
      console.error(`Spreadsheet with ID ${spreadsheetId} does not exist.`);
      return false;
    } else if (error.code === 403) {
      // Permission denied
      console.error(`Access denied to spreadsheet with ID ${spreadsheetId}.`);
      throw new Error('Access denied to the spreadsheet.');
    } else {
      // Other errors
      console.error('Error checking spreadsheet existence:', error);
      throw error;
    }
  }
};

const sheetExists = async (sheets, spreadsheetId, sheetName) => {
  try {
    // Retrieve the spreadsheet metadata
    const response = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties.title',
    });

    // Check if the sheet name exists in the list of sheets
    const sheet = response.data.sheets.find(
      (s) => s.properties.title === sheetName
    );

    return !!sheet; // Returns true if the sheet exists, false otherwise
  } catch (error) {
    console.error('Error checking sheet existence:', error);
    throw error;
  }
};

const writeToSheet = async ({sheets, spreadsheetId, sheetName, rows}) => {
  // console.log('spreadsheetId', spreadsheetId);
  // console.log('sheetName', sheetName);
  // console.log('rows', rows.length);  
   
  // Prepare data for writing
  const headers = Object.keys(rows[0]);
  const values = [headers];

  rows.forEach(row => {
    values.push(headers.map(header => row[header]));
  });

  // Clear the sheet first
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: sheetName, // This clears the entire sheet
  });

  console.log(`cleared sheet: ${sheetName}`);

  // Write data to the sheet
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: 'RAW',
    requestBody: {
      values,
    },
  });

  console.log(`Wrote ${values.length} rows to sheet: ${sheetName}`)
};


Util.setupApi(baseURL);

const formatDate = (dateString) => {
  if (!dateString) return '';
  try {
    const options = { timeZone: 'Asia/Singapore' };
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      return 'Invalid Date';
    }
    return date.toLocaleDateString('en-GB', options); // Format as 'dd/MM/yyyy, HH:mm:ss'
  } catch (error) {
    console.error(`Error formatting date: ${dateString}`, error);
    return 'Invalid Date';
  }
};


const main = async () => {

  const sheets = getSheetsClient();

  // Check if the spreadsheet exists
  const spreadSheetCheck = await spreadsheetExists(sheets, spreadsheetId);
  if (!spreadSheetCheck) {
    throw new Error(`Spreadsheet with ID ${spreadsheetId} does not exist. Stopping.`);
  }

  await Util.login(username, password);  

  for (const sheetName in sheetToJobIdMapping) {

    // Check if the Sheet exists
    const sheetCheck = await sheetExists(sheets, spreadsheetId, sheetName);
    if (!sheetCheck) {
      console.log(`SheetName ${sheetName} with for SS_ID ${spreadsheetId} does not exist. Skipping.`);
      continue;
    }
    
    const jobIds = sheetToJobIdMapping[sheetName];

    let tasks = [];

    for (const jobId of jobIds) {      

      console.log('Starting on job:', jobId);
  
      // Fetch resolved tasks
      const resolvedTasks = await Util.getJobResolvedTasksByPage({
        jobId,
        limit: 10,
        currentPage: 1
      });
      console.log('Resolved tasks count:', resolvedTasks.length);
  
      tasks.push(...resolvedTasks);
  
      // Fetch pending tasks
      const pendingTasks = await Util.getJobPendingTasksByPage({
        jobId,
        limit: 10,
        currentPage: 1
      });
      console.log('Pending tasks count:', pendingTasks.length);
  
      tasks.push(...pendingTasks);
    }
  
    /**
     * Current Data:
     *   [{
     *     submitted_at: '2024-09-19T10:02:09.615Z',
     *     first_tag_at: '2024-09-19T10:02:07.424Z',
     *     assigned_at: '2024-09-19T10:01:41.985Z',
     *     items: [ [Object], [Object], [Object] ],
     *     taskQuestionAnswers: [ [Object], [Object] ]
     *   }]
     */
  
    const rows = [];
  
    // Use a for...of loop to handle asynchronous operations
    for (const task of tasks) {
      // Access taskQuestionAnswers from the task
      const nameAnswer = task.taskQuestionAnswers.find(
        tq => tq.title === process.env.TQ_QUESTIONTITLE_NAME
      );
      const name = nameAnswer && nameAnswer.answer ? nameAnswer.answer : '';
  
      const classAnswer = task.taskQuestionAnswers.find(
        tq => tq.title === process.env.TQ_QUESTIONTITLE_CLASS
      );
      const className = classAnswer && classAnswer.answer ? classAnswer.answer : '';
  
      // Iterate over task items
      for (const item of task.items) {
        rows.push({
          'Job ID': item.job_id,
          'Task ID': item.user_task_id,
          'Submit Date': formatDate(task.submittedAt),
          'Name': name,
          'Class': className,
          'File Name': item.filename,
          'Answer': item.tags
        });
      }
    }

  
    // Write all rows to the sheet at once
    await writeToSheet({sheets, spreadsheetId, sheetName, rows});

  }

  
};

main();