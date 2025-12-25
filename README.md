# 🎯 VisionHack Submission Portal

A comprehensive hackathon submission portal built with Next.js, Appwrite, and TypeScript, featuring an automated **cascade inviting system** for managing campus leads and team leads.

## ✨ Features

### 🔄 Cascade Inviting System
- **Bulk Campus Lead Creation**: Upload CSV to create 250+ campus lead accounts automatically
- **Automated Credentials**: Generate secure passwords and send via email
- **Team Lead Invitations**: Campus leads can invite up to 5 team leads each
- **Email Notifications**: Beautiful HTML emails with login credentials
- **Role-Based Access**: Admin, Campus Lead, and Team Lead dashboards

### 🎨 Modern UI/UX
- Minimal white theme design
- Framer Motion animations
- Responsive layouts
- Toast notifications (Sonner)
- Radix UI components

### 🔐 Security
- Role-based authentication via Appwrite
- Secure password generation
- Server-side API key protection
- Input validation and sanitization

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ installed
- Appwrite instance (cloud or self-hosted)
- Email service (optional for development)

### Installation

1. **Clone and install dependencies**
```bash
npm install
```

2. **Configure environment variables**
```env
# .env.local
NEXT_PUBLIC_APPWRITE_ENDPOINT="https://your-appwrite.com/v1"
NEXT_PUBLIC_APPWRITE_PROJECT_ID="your_project_id"
APPWRITE_API_KEY="your_api_key_here"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

3. **Set up Appwrite collections**

See [QUICK-SETUP.md](./docs/QUICK-SETUP.md) for detailed database schema.

4. **Run development server**
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the portal.

## 📖 Documentation

### Complete Guides
- **[🚀 QUICK-SETUP.md](./docs/QUICK-SETUP.md)** - Step-by-step setup instructions
- **[📚 CASCADE-INVITING.md](./docs/CASCADE-INVITING.md)** - Complete feature documentation
- **[📊 SYSTEM-FLOW.md](./docs/SYSTEM-FLOW.md)** - Visual flow diagrams
- **[✅ CHECKLIST.md](./docs/CHECKLIST.md)** - Pre-launch verification
- **[📋 IMPLEMENTATION-SUMMARY.md](./docs/IMPLEMENTATION-SUMMARY.md)** - What's been built

### Quick Links
- Sample CSV: [docs/sample-campus-leads.csv](./docs/sample-campus-leads.csv)
- API Documentation: See [CASCADE-INVITING.md](./docs/CASCADE-INVITING.md#api-endpoints)

## 🎯 System Overview

```
Admin → Upload CSV with 250 colleges
   ↓
System creates 250 campus lead accounts
   ↓
Campus leads receive email with credentials
   ↓
Campus leads invite 5 team leads each
   ↓
Team leads receive email with credentials
   ↓
Team leads register teams & submit projects
```

**Capacity**: 250 colleges → 1,250 team leads → 1,250 teams

## 📁 Project Structure

```
src/
├── app/
│   ├── admin/               # Admin pages
│   │   ├── dashboard/       # Admin dashboard
│   │   └── campus-leads/    # CSV upload page
│   ├── institution/         # Campus lead pages
│   │   └── dashboard/       # Team lead invitation
│   ├── team/               # Team lead pages
│   └── api/                # API routes
│       ├── admin/
│       │   └── create-campus-leads/
│       └── institution/
│           └── create-team-leads/
├── components/
│   ├── animations/         # Framer Motion animations
│   ├── layout/            # Header, Footer
│   └── ui/                # Reusable UI components
├── lib/
│   ├── appwrite.ts        # Appwrite configuration
│   ├── auth-service.ts    # User account creation
│   └── email-service.ts   # Email notifications
└── docs/                  # Documentation
```

## 🔑 Key Features Implemented

### For Admins
- ✅ Bulk upload CSV with campus leads
- ✅ Auto-create user accounts in Appwrite
- ✅ Auto-generate secure passwords
- ✅ Send credentials via email
- ✅ View creation results and statistics

### For Campus Leads
- ✅ Login with auto-generated credentials
- ✅ View institution dashboard
- ✅ Invite up to 5 team leads
- ✅ Dynamic form with add/remove fields
- ✅ Real-time validation

### For Team Leads
- ✅ Receive email invitation
- ✅ Login to team dashboard
- ✅ Access team registration (ready for implementation)

## 🛠️ Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **Backend**: Appwrite (Auth, Database, Storage)
- **UI Components**: Radix UI
- **Styling**: Tailwind CSS
- **Animations**: Framer Motion
- **Notifications**: Sonner
- **Icons**: Lucide React

## 📧 Email System

The system includes beautiful HTML email templates for:
- **Campus Lead Invitations** - Welcome message with credentials
- **Team Lead Invitations** - Shortlist notification with credentials

Configure your email service:
- Appwrite Messaging (recommended)
- Resend / SendGrid / Mailgun
- Console logging (development)

## 🔐 User Roles

| Role | Label | Permissions |
|------|-------|-------------|
| Admin | `admin` | Create campus leads, manage system |
| Campus Lead | `institution` | Invite team leads, view teams |
| Team Lead | `lead` | Register team, submit project |

## 🧪 Testing

Use the sample CSV file:
```bash
docs/sample-campus-leads.csv
```

Contains 10 sample colleges for testing.

## 🚀 Deployment

### Vercel (Recommended)
1. Push to GitHub
2. Import to Vercel
3. Add environment variables
4. Deploy!

### Environment Variables for Production
```env
NEXT_PUBLIC_APPWRITE_ENDPOINT="https://your-production-appwrite.com/v1"
NEXT_PUBLIC_APPWRITE_PROJECT_ID="production_project_id"
APPWRITE_API_KEY="production_api_key"
NEXT_PUBLIC_APP_URL="https://your-domain.com"
```

## 📊 Database Schema

### institutions Collection
- Stores college information
- Links to campus lead user ID
- Tracks team registration stats

### teams Collection
- Stores team information
- Links to institution
- Links to team lead user ID

See [QUICK-SETUP.md](./docs/QUICK-SETUP.md) for complete schema.

## 🤝 Contributing

This is a private project for VisionHack. For issues or questions, contact the development team.

## 📝 License

Copyright © 2025 VisionHack. All rights reserved.

## 🎉 What's Next?

After setup:
1. Configure Appwrite API key
2. Set up database collections
3. Upload CSV with campus leads
4. Campus leads invite team leads
5. Start accepting team registrations!

---

**Need help?** Check the [documentation](./docs/) or review the setup guides.

**Ready to go?** Follow [QUICK-SETUP.md](./docs/QUICK-SETUP.md) to get started!
