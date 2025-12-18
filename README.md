# Vision Hack 2026 - Portal & Backend Specification

## 1. System Overview
This repository (`vision-hack-portal`) hosts the interactive dashboard for the Vision Hack 2026 hackathon. [cite_start]It handles Authentication, Team Registration, Institutional Nominations, and Administrative Control[cite: 7].

**Note:** The Public Landing Page is a separate application. This application handles the logic for:
* [cite_start]**Super Admin:** Governance, content management, results[cite: 74].
* [cite_start]**Institution:** Viewing teams, nominating top 5[cite: 90].
* [cite_start]**Team Leader:** Registration, member management, submission[cite: 98].

## 2. Tech Stack
* **Frontend:** Next.js 14+ (App Router), Tailwind CSS, ShadcnUI.
* **Backend:** Self-Hosted Appwrite (running on Oracle ARM Docker).
* **Language:** TypeScript (Strict Mode).
* **State/Validation:** React Hook Form + Zod.

---

## 3. Database Schema (Appwrite)

### 3.1 Collection: `institutions`
[cite_start]*Stores the ~250 pre-registered colleges[cite: 90].*
* `$id`: (Auto-generated)
* `name`: String (Required)
* `code`: String (Unique, e.g., "MACE")
* `email`: Email (Required, matches Auth email)
* [cite_start]`is_nominated_locked`: Boolean (Default: `false`) [cite: 95]
* **Permissions:** Read (Any Auth), Update (Admin only).

### 3.2 Collection: `teams`
*Main entity for participation.*
* `$id`: (Auto-generated)
* [cite_start]`name`: String (Required) [cite: 102]
* [cite_start]`leader_user_id`: String (Links to Appwrite Auth User) [cite: 104]
* [cite_start]`institution_id`: String (Relationship to `institutions`) [cite: 105]
* [cite_start]`status`: Enum [`registered`, `nominated`, `submitted`, `selected`, `rejected`, `waitlisted`] (Default: `registered`) [cite: 89]
* [cite_start]`idea_title`: String (Nullable) [cite: 118]
* [cite_start]`idea_desc`: String (Long Text, Nullable) [cite: 118]
* [cite_start]`idea_tech_stack`: String (Nullable) [cite: 118]
* [cite_start]`submission_file_id`: String (Nullable, links to Storage) [cite: 117]
* [cite_start]`mentor_name`: String (Nullable) [cite: 121]
* [cite_start]`mentor_contact`: String (Nullable) [cite: 125]
* **Permissions:** Read (Own Leader, Own Institution), Create (Student), Update (Leader - Restricted).

### 3.3 Collection: `members`
[cite_start]*Stores details of the 4 other team members[cite: 108].*
* `team_id`: String (Relationship to `teams`)
* [cite_start]`full_name`: String [cite: 109]
* [cite_start]`email`: Email [cite: 110]
* [cite_start]`phone`: String [cite: 111]
* [cite_start]`gender`: Enum [`Male`, `Female`, `Other`] [cite: 112]
* [cite_start]`role`: String (e.g., Developer, Designer) [cite: 113]

### 3.4 Collection: `config`
[cite_start]*Global event switches managed by Super Admin[cite: 78].*
* `key`: String (Primary Key, e.g., "submission_window")
* `value_bool`: Boolean
* `value_text`: String
* *Required Keys:* `registration_open`, `nomination_open`, `submission_open`.

### 3.5 Collection: `themes`
[cite_start]*Dynamic themes displayed on the portal[cite: 38].*
* [cite_start]`title`: String [cite: 40]
* [cite_start]`description`: String [cite: 41]
* [cite_start]`relevance`: String [cite: 42]
* [cite_start]`problem_area`: String [cite: 43]

### 3.6 Collection: `gallery`
[cite_start]*Images uploaded by Admin for the gallery[cite: 31].*
* `image_file_id`: String
* `caption`: String

---

## 4. Storage Buckets

### Bucket: `submissions`
* [cite_start]**Content:** Idea PPTs/PDFs[cite: 117].
* **Max Size:** 10MB.
* **Permissions:** Create (Team Leader), Read (Admin, Institution).

### Bucket: `assets`
* **Content:** Gallery images, Theme icons.
* **Permissions:** Public Read, Admin Write.

---

## 5. Security & Access Control (RLS)

The middleware and Appwrite permissions must enforce:
1.  [cite_start]**Strict Isolation:** Institutions can ONLY view teams where `team.institution_id` matches their profile[cite: 93]. [cite_start]They cannot see other colleges' data[cite: 97].
2.  [cite_start]**Immutable Nominations:** Once an Institution sets `is_nominated_locked = true`, they cannot toggle nominations anymore[cite: 95].
3.  [cite_start]**Submission Deadlines:** Upload endpoints must fail if `config.submission_open` is `false`[cite: 119].
4.  [cite_start]**Edit Locks:** Teams cannot edit member details after the registration deadline[cite: 128].

---

## 6. Server Actions (Business Logic)

### 6.1 `actions/institution.ts`
* **`toggleNomination(teamId, shouldNominate)`**:
    * *Validation:* Fetch count of teams with `status='nominated'` for this institution.
    * [cite_start]*Constraint:* If count >= 5 and `shouldNominate` is true, **THROW ERROR** "Max 5 teams allowed"[cite: 95].
    * *Check:* Ensure `is_nominated_locked` is false.
* **`lockNominations(institutionId)`**:
    * Sets `is_nominated_locked` to true.

### 6.2 `actions/team.ts`
* **`registerTeam(data)`**:
    * Creates Team document + 4 Member documents in a transaction.
* **`submitIdea(formData)`**:
    * Uploads file to `submissions` bucket.
    * Updates `teams` document with `submission_file_id`.
    * *Check:* `config.submission_open` must be true.

### 6.3 `actions/admin.ts`
* **`exportData()`**:
    * [cite_start]Streaming download of all teams joined with member data[cite: 81].
* **`assignMentor(teamId, mentorData)`**:
    * [cite_start]Updates `mentor_name` and `mentor_contact` fields[cite: 87].

---

## 7. App Router Structure


src/
├── app/
│   ├── (auth)/
│   │   └── login/            # Role-based login (Admin/College/Student)
│   ├── (dashboard)/
│   │   ├── admin/            # [PROTECTED: role=admin]
│   │   │   ├── teams/        # Master team list
│   │   │   ├── config/       # Event stage controls
│   │   │   └── content/      # Manage Themes/Gallery
│   │   ├── institution/      # [PROTECTED: role=institution]
│   │   │   └── dashboard/    # Team list with "Nominate" toggles
│   │   └── student/          # [PROTECTED: role=team_leader]
│   │       ├── dashboard/    # Status view
│   │       ├── edit/         # Member management
│   │       └── submit/       # Idea upload zone
│   └── api/                  # Webhooks (if needed)
├── lib/
│   ├── appwrite.ts           # Admin & Client SDK setup
│   └── types.ts              # TypeScript interfaces for DB schema
└── middleware.ts             # Route protection logic 

![Userflow](https://github.com/Phloraxx/VisionHack_Submission-Portal/blob/main/mermaid-diagram-2025-12-17-215912.png)
