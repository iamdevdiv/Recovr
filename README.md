# Recovr

I originally built Recovr to help my dad automate the manual, repetitive workflows he deals with at his office. He handles assigning cases, tracking field officers, and processing massive excel sheets of collection data on a daily basis. Doing all of that manually was incredibly tedious, so I wrote this system to take care of the heavy lifting.

To be completely transparent, a lot of this application was vibe coded. It gets the job done and solves the exact problems it was built for, but you probably shouldn't expect a pristine, textbook enterprise architecture under the hood. It works, and it works well for our use case.


## Running Locally

1. Make sure you have MongoDB installed and running.
2. Copy `.env.example` to `.env` and fill in your database URI and a secure, random string for your `JWT_SECRET`.
3. Create your initial admin account by running the following command in your terminal:
   `npm run create:admin -- <EmployeeID> <Password> "<Your Name>"`
4. Start the backend by running `npm run start`.
5. Start the frontend development server by running `npm run dev`.

## Core Features

- **Role-based Access Control**: Secure login system for Admins, Managers, and Field Officers using JWT and bcrypt.
- **Automated Excel Processing**: Instantly parses and formats massive Excel sheets for current allocation lots and old historical reference workbooks.
- **Offline-First Field Officer Dashboard**: Field Officers (FOS) can view their assigned cases and submit updates even when they lose internet connection. The app uses a Service Worker and IndexedDB to cache data and queue updates, automatically syncing to the database once a connection is restored.
- **Historical Data Matching**: Automatically links current cases to past interactions, contact numbers, and previous payments so agents have full context.
- **AI-Powered Tagging**: Integrates with Groq API to intelligently analyze case notes and automatically assign descriptive tags to help managers quickly categorize responses.