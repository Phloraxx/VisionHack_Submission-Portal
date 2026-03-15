
import { NextRequest, NextResponse } from 'next/server';
import { serverDatabases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite-server';
import { ID } from 'node-appwrite';

export async function GET() {
    try {
        const response = await serverDatabases.listDocuments(
            DATABASE_ID,
            COLLECTIONS.CONFIG,
        );

        // Default config
        const config = {
            registration: false,
            nomination: false,
            submissions: false,
            questionnaire: false
        };

        // Map documents to config
        response.documents.forEach((doc: any) => {
            if (doc.key === 'registration_open') config.registration = doc.value_bool;
            if (doc.key === 'nomination_open') config.nomination = doc.value_bool;
            if (doc.key === 'submission_open') config.submissions = doc.value_bool;
            if (doc.key === 'questionnaire_open') config.questionnaire = doc.value_bool;
        });

        return NextResponse.json({ success: true, config });

    } catch (error: any) {
        console.error('Error fetching config:', error);
        return NextResponse.json({ error: 'Failed to fetch configuration' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        // body is expected to be { registration: bool, nomination: bool, submissions: bool }

        // We need to fetch existing docs to find their IDs
        const listResponse = await serverDatabases.listDocuments(
            DATABASE_ID,
            COLLECTIONS.CONFIG,
        );

        const updatePromises = [];

        // Helper to find doc by key
        const findDoc = (key: string) => listResponse.documents.find((d: any) => d.key === key);

        // 1. Registration
        const regDoc = findDoc('registration_open');
        if (regDoc && body.registration !== undefined) {
            updatePromises.push(serverDatabases.updateDocument(
                DATABASE_ID, COLLECTIONS.CONFIG, regDoc.$id, { value_bool: body.registration }
            ));
        }

        // 2. Nomination
        const nomDoc = findDoc('nomination_open');
        if (nomDoc && body.nomination !== undefined) {
            updatePromises.push(serverDatabases.updateDocument(
                DATABASE_ID, COLLECTIONS.CONFIG, nomDoc.$id, { value_bool: body.nomination }
            ));
        }

        // 3. Submissions
        const subDoc = findDoc('submission_open');
        if (subDoc && body.submissions !== undefined) {
            updatePromises.push(serverDatabases.updateDocument(
                DATABASE_ID, COLLECTIONS.CONFIG, subDoc.$id, { value_bool: body.submissions }
            ));
        }

        // 4. Questionnaire
        const questDoc = findDoc('questionnaire_open');
        if (questDoc && body.questionnaire !== undefined) {
            updatePromises.push(serverDatabases.updateDocument(
                DATABASE_ID, COLLECTIONS.CONFIG, questDoc.$id, { value_bool: body.questionnaire }
            ));
        }

        await Promise.all(updatePromises);

        // Return updated state
        return NextResponse.json({ success: true, config: body });

    } catch (error: any) {
        console.error('Error updating config:', error);
        return NextResponse.json({ error: 'Failed to update configuration' }, { status: 500 });
    }
}
