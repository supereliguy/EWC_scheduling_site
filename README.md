# Schedule Manager

A Node.js web application for managing work schedules. It allows users to submit schedule requests (Work/Off) and administrators to generate, view, and publish schedules using an automated algorithm.

## Features

*   **User Dashboard:** Users can log in, view the calendar, and submit requests for specific days (Work/Off).
*   **Admin Dashboard:** Administrators can manage users, sites, and shifts.
*   **Automated Scheduling:** Uses a randomized greedy algorithm with restarts to generate schedules that respect user constraints and preferences.
*   **iCal Subscription:** Users can subscribe to their work schedule via a private iCal feed.
*   **Export:** Schedules can be exported to CSV.

## Prerequisites

*   [Node.js](https://nodejs.org/) (v16 or higher recommended)
*   npm (comes with Node.js)

## Installation

1.  **Clone the repository:**
    ```bash
    git clone <repository_url>
    cd <repository_name>
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Initialize the Database:**
    Run the seed script to create the SQLite database (`schedule.db`) and the initial admin user.
    ```bash
    node seed.js
    ```
    *   **Default Admin Credentials:**
        *   Username: `admin`
        *   Password: `password123`

## Running the Application

1.  **Start the server:**
    ```bash
    npm start
    ```
    The server will start on port 3000 (default).

2.  **Access the application:**
    Open your browser and navigate to `http://localhost:3000`.

## Usage

### As a User:
1.  Go to `http://localhost:3000/login.html`.
2.  Log in with your credentials (provided by an admin).
3.  Use the calendar to click and "paint" your requests:
    *   **Work (Blue):** Request to work this day.
    *   **Off (Red):** Request to be off this day.
    *   **Clear:** Clear any request.
4.  Click **Submit Requests** to save.
5.  Once the schedule is published, switch to **View Schedule** mode to see your assigned shifts.

### As an Admin:
1.  Log in as `admin`.
2.  Navigate to `http://localhost:3000/admin.html`.
3.  **Users:** Create new users and manage roles.
4.  **Sites & Shifts:** Create sites (e.g., "Main Hospital") and define shifts (e.g., "Day Shift 08:00-16:00").
5.  **Schedule:**
    *   Select a Site, Year, and Month.
    *   **Generate:** Run the algorithm to create a draft schedule.
    *   **View:** See the current draft or published schedule.
    *   **Publish:** Make the schedule visible to users.

## Project Structure

*   `server.js`: Application entry point.
*   `src/`: Backend source code.
    *   `app.js`: Express app setup.
    *   `db.js`: Database connection and schema.
    *   `routes/`: API endpoints.
    *   `lib/scheduler.js`: Scheduling algorithm.
*   `public/`: Frontend static files (HTML, CSS, JS).
