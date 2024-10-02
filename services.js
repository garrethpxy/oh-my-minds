import axios from 'axios';

let api;
let baseUrl = "";

export function setupApi(baseURL, defaultHeaders = {}) {
    api = axios.create({
        baseURL,
        headers: defaultHeaders
    });

    baseUrl = baseURL;
}

function handleError(error) {
    const errorData = {
        message: "An error occurred while processing your request.",
        status: null,
        details: null
    };

    if (error.response) {
        // The request was made and the server responded with a status code
        errorData.status = error.response.status;
        errorData.message = error.response.data.message || errorData.message; // Extract a specific error message if available
        errorData.details = error.response.data.details || error.response.data; // Additional details from the response
    } else if (error.request) {
        // The request was made but no response was received
        errorData.message = "No response received from the server. Please check your connection.";
    } else {
        // Something happened in setting up the request that triggered an Error
        errorData.message = error.message;
    }

    console.error(errorData); // Log the structured error data
    throw errorData; // Re-throw the structured error
}

export async function login(username, password){
    const loginResponse = await axios.post(`${baseUrl}/auth/login`, {
        username,
        password
      });
    
    const token = loginResponse.data.access_token;

    api.interceptors.request.use(config => {
        config.headers['Authorization'] = `Bearer ${token}`;
        return config;
    });

    // Add response interceptor for global error handling
    api.interceptors.response.use(
        response => response, // Pass successful responses through
        error => {
            return Promise.reject(handleError(error)); // Handle and re-throw error
        }
    );

}

export async function getJobPendingTasksByPage({jobId, status, limit = 10, currentPage, results = []}) {
    const payload = {
        status, limit, 
        page: currentPage,
        job_id: jobId
    };
    
    // get the task list
    const taskResponse = await api.get('/admin/coins/preview', {params: payload});

    let taskList = taskResponse.data.data;

    // console.log('received pending: ', taskList.length);

    // add jobId to task objects
    taskList = taskList.map(task => ({jobId, ...task}));

    // get additional details for each task (needed for submission date)
    const taskDetails = await getTasksWithDetails(taskList);
    // accumulate the results
    results.push(...taskDetails);
    
    // Check if we've reached the last page
    if (taskResponse.data.paginate?.pages.next) { 
        // Fetch next page
        return await getJobPendingTasksByPage({jobId, status, limit, currentPage: currentPage + 1, results}); 
    } else {
        return results; // All pages fetched
    }    
}

export async function getJobResolvedTasksByPage({jobId, status, limit = 10, currentPage, results = []}) {
    
    const payload = {
        status, 
        limit, 
        page: currentPage,
        job_id: jobId
    };
    
    // get the task list
    const taskResponse = await api.get('/admin/coins/resolved', {params: payload});

    let taskList = taskResponse.data.data;

    // console.log('received resolved: ', taskList.length);

    // add jobId to task objects
    taskList = taskList.map(task => ({jobId, ...task}));

    // get additional details for each task (needed for submission date)
    const taskDetails = await getTasksWithDetails(taskList);
    // accumulate the results
    results.push(...taskDetails);
    
    // Check if we've reached the last page
    if (taskResponse.data.paginate?.pages.next) { 
        // Fetch next page
        return await getJobResolvedTasksByPage({jobId, status, limit, currentPage: currentPage + 1, results}); 
    } else {
        return results; // All pages fetched
    }    
}

export async function getTasksWithDetails(taskList) {
    // console.log('getting tasks details');
    try {        
        const taskDetailsData = [];
        const BATCH_SIZE = 5;
        for (let i = 0; i < taskList.length; i += BATCH_SIZE) {
          const batch = taskList.slice(i, i + BATCH_SIZE);
    
          const taskDetailsPromises = batch.map(async (item) => {
            const details = await getTaskDetails({userTaskId: item.user_task_id});   

            const taskQuestionAnswers 
                = await getTaskQuestionnaireSubmission({jobId: item.jobId, userTaskId: item.user_task_id});            
            
            return { 
                submittedAt: details.tracking_info?.submitted_at,
                assignedAt: details.assigned_at, 
                items: details.items,
                taskQuestionAnswers: taskQuestionAnswers.data 
                    && taskQuestionAnswers.data.length 
                    && taskQuestionAnswers.data.map(tqItem => {
                    return {
                        title: tqItem.title,
                        answer: tqItem.answer,
                    }
                })   
             };
          });
          
          const batchResults = await Promise.all(taskDetailsPromises);
          taskDetailsData.push(...batchResults);
        }
        
        return taskDetailsData;

      } catch (error) {
        console.error('Error in getTasksWithDetails:', error);
        throw error;
      }
}

export async function getTaskDetails({ userTaskId }, retries = 10, delay = 1000) { 
    if (!userTaskId) throw new Error('userTaskId must be provided');

    try {
        const response = await api.get('/tasks/user-task-items', {
            params: { user_task_id: userTaskId }
        });
        return response.data;  // Make sure to return the data
    } catch (error) {
        console.log('error!', error);
        if (retries > 0) { // 504 is Gateway Timeout
            console.warn(`Request error. Retrying in ${delay}ms... (Attempts left: ${retries})`);
            await new Promise(resolve => setTimeout(resolve, delay)); // Wait before retrying
            return getTaskDetails({ userTaskId }, retries - 1, delay); 
        } else {
            throw error; // Rethrow other errors
        }
    }
}

// does the same thing as getTaskDetails
export async function getTaskItems({ userTaskId }, retries = 10, delay = 1000) { 
    if (!userTaskId) throw new Error('userTaskId must be provided');

    try {
        const response = await api.get('/tasks/task-items', {
            params: { usertask_id: userTaskId }
        });
        return response.data;  // Make sure to return the data
    } catch (error) {
        console.log('error!', error);
        if (retries > 0) { // 504 is Gateway Timeout
            console.warn(`Request error. Retrying in ${delay}ms... (Attempts left: ${retries})`);
            await new Promise(resolve => setTimeout(resolve, delay)); // Wait before retrying
            return getTaskDetails({ userTaskId }, retries - 1, delay); 
        } else {
            throw error; // Rethrow other errors
        }
    }
}

export async function getTaskQuestionnaireSubmission({jobId, userTaskId}) {
    if (!userTaskId) throw new Error('userTaskId must be provided');
    if(!jobId) throw new Error('jobId must be provided');

    try {
        const response = await api.get('/admin/task-questionnaire/user-submit', {
            params: { 
                user_task_id: userTaskId,
                job_id: jobId,
            }
        });
        return response.data;  // Make sure to return the data
    } catch (error) {
        throw error;
    }
}


