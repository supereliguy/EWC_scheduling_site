window.APP_VERSION = "3.2.0";
window.CHANGELOG = [
    {
        version: "3.2.0",
        date: "2024-05-23",
        changes: [
            "Introduced 'Fair Distribution' logic: automatically scales user targets based on total available shifts.",
            "Implemented squared scoring weights to prioritize users who are furthest behind their target.",
            "Added 'Distribution & Constraints Analysis' table to the generation report.",
            "Now tracking and displaying the top reason preventing each user from getting more shifts (e.g. Availability, Rest)."
        ]
    },
    {
        version: "3.1.0",
        date: "2024-05-22",
        changes: [
            "Added version number display in the header.",
            "Added 'What's New' changelog modal to track updates.",
            "Implemented aggressive caching updates to ensure you always see the latest version."
        ]
    },
    {
        version: "3.0.0",
        date: "2024-05-01",
        changes: [
            "Initial Release of Ultimate Scheduler v3.",
            "Complete rewrite with improved UI and performance.",
            "Added Google Sheets integration.",
            "Added PDF and CSV export."
        ]
    }
];
