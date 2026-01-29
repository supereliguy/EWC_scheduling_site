# Node.js Schedule App

A robust scheduling application built with Node.js, Express, and SQLite.

## Features
- **User Interface**: Submit work/off requests, view personal schedule.
- **Admin Interface**: Manage users, sites, shifts, and generate schedules.
- **Scheduler**: Randomized Greedy algorithm with restarts, respecting user preferences (Night/Day weight, Max consecutive shifts, Min days off).

## Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Initialize the database:
   ```bash
   node seed.js
   ```

3. Start the server:
   ```bash
   npm start
   ```

4. Open your browser to `http://localhost:3000`.

## Usage

### Admin Login
- **Username**: `admin`
- **Password**: `password123`

### Workflow
1. Log in as Admin.
2. Go to "Sites & Shifts" to create a Site and its Shifts.
3. Go to "Users" to create user accounts.
4. Users log in to submit requests.
5. Admin goes to "Schedule", selects Month/Year, and clicks "Generate".
6. Admin publishes the schedule.

## Tech Stack
- **Backend**: Node.js, Express
- **Database**: SQLite (better-sqlite3)
- **Frontend**: HTML/CSS/JS (Vanilla)
