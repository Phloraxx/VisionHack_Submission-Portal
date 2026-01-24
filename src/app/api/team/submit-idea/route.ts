import { NextRequest, NextResponse } from 'next/server';
import { serverDatabases, serverStorage, DATABASE_ID, COLLECTIONS, BUCKETS } from '@/lib/appwrite-server';
import { ID, Query } from 'node-appwrite';

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const userId = formData.get('userId') as string;
        const ideaTitle = formData.get('ideaTitle') as string;
        const ideaDescription = formData.get('ideaDescription') as string;
        const techStack = formData.get('techStack') as string;
        const file = formData.get('file') as File;

        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (!ideaTitle || !ideaDescription || !techStack || !file) {
            return NextResponse.json({ error: 'All fields are required' }, { status: 400 });
        }

        // Check Event Configuration
        const configDocs = await serverDatabases.listDocuments(
            DATABASE_ID,
            COLLECTIONS.CONFIG
        );

        const submissionConfig = configDocs.documents.find((d: any) => d.key === 'submission_open');
        const isSubmissionOpen = submissionConfig ? submissionConfig.value_bool : false;

        if (!isSubmissionOpen) {
            return NextResponse.json({ error: 'Idea submissions are currently closed.' }, { status: 403 });
        }

        // Identify Team
        const teamsQuery = await serverDatabases.listDocuments(
            DATABASE_ID,
            COLLECTIONS.TEAMS,
            [Query.equal('leader_user_id', userId)]
        );

        if (teamsQuery.total === 0) {
            return NextResponse.json({ error: 'Team not found' }, { status: 404 });
        }

        const team = teamsQuery.documents[0];

        // Upload File
        let fileId = '';
        try {
            // Pass the File object directly. 
            // Node-appwrite (and underling axios/fetch) should handle File/Blob in standard Node.js environments
            const uploadedFile = await serverStorage.createFile(
                BUCKETS.SUBMISSIONS,
                ID.unique(),
                file
            );
            fileId = uploadedFile.$id;
        } catch (error: any) {
            console.error('File upload failed:', error);
            return NextResponse.json({ error: 'File upload failed' }, { status: 500 });
        }

        // Update Team Document
        try {
            await serverDatabases.updateDocument(
                DATABASE_ID,
                COLLECTIONS.TEAMS,
                team.$id,
                {
                    idea_title: ideaTitle,
                    idea_desc: ideaDescription,
                    idea_tech_stack: techStack,
                    submission_file_id: fileId,
                    status: 'submitted',
                }
            );
        } catch (error: any) {
            console.error('Database update failed:', error);
            // Cleanup file if DB update fails?
            // await serverStorage.deleteFile(BUCKETS.SUBMISSIONS, fileId);
            return NextResponse.json({ error: 'Failed to save submission details' }, { status: 500 });
        }

        return NextResponse.json({ success: true, message: 'Idea submitted successfully!' });

    } catch (error: any) {
        console.error('Submission error:', error);
        return NextResponse.json({ error: error.message || 'Server error' }, { status: 500 });
    }
}
