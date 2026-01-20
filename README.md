This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

The app aims to make a management interface to lookup metadata for movies and shows in my personal collection. It uses the [OMDB API](https://www.omdbapi.com/#usage) to lookup the information about the media and then stores the information in the firebase firestore setup for the project. From here, once all of the metadata is stored for my collection I can connect the a rag-ai agent to answer questions/queries about the movies in my collection.

First Look at development:
![screenshot of development](./assets/Screenshot_Early_development.png)

## Getting Started

This application consists of two parts: a **FastAPI backend** for file scanning and operations, and a **Next.js frontend** for the web interface.

### Prerequisites

- Node.js (v16 or later)
- Python 3.11
- npm or yarn

### Starting the Backend (FastAPI)

The backend handles library scanning, file operations, and metadata management.

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Install Python dependencies (first time only):
   ```bash
   pip install -r requirements.txt
   ```

3. Start the backend server:
   ```bash
   python start.py
   ```

The backend API will be available at [http://localhost:8082](http://localhost:8082)

### Starting the Frontend (Next.js)

The frontend provides the web interface for managing your media library.

1. From the project root directory, install dependencies (first time only):
   ```bash
   npm install
   ```

2. Start the development server:
   ```bash
   npm run dev
   # or
   yarn dev
   # or
   pnpm dev
   # or
   bun dev
   ```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the application.

### Running Both Services

For full functionality, both the backend and frontend need to be running simultaneously:

**Terminal 1 - Backend:**
```bash
cd backend
python start.py
```

**Terminal 2 - Frontend:**
```bash
npm run dev
```

### Development URLs

**Frontend:**
- Home Page: [http://localhost:3000](http://localhost:3000)
- Admin Page: [http://localhost:3000/admin](http://localhost:3000/admin)
- Library Browser: [http://localhost:3000/admin/libraryBrowser](http://localhost:3000/admin/libraryBrowser)
- Media Assignment: [http://localhost:3000/admin/libraryBrowser/assignment](http://localhost:3000/admin/libraryBrowser/assignment)
- Dashboard Page: [http://localhost:3000/dashboard](http://localhost:3000/dashboard)
- Dashboard Media Page: [http://localhost:3000/dashboard/media](http://localhost:3000/dashboard/media)
- Media Info Page: [http://localhost:3000/dashboard/media/info](http://localhost:3000/dashboard/media/info)

**Backend:**
- API Base URL: [http://localhost:8082/api](http://localhost:8082/api)
- API Documentation: [http://localhost:8082/docs](http://localhost:8082/docs)

### Development - Getting Started

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

### Fonts

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.


