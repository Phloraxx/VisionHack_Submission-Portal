// src/app/team/dashboard/page.tsx - Team Lead Dashboard
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FadeIn } from '@/components/animations/FadeIn';
import { SlideIn } from '@/components/animations/SlideIn';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { authHelpers, UserRole, databases, DATABASE_ID, COLLECTIONS } from '@/lib/appwrite';
import { Users, Upload, FileText, Award } from 'lucide-react';
import { motion } from 'framer-motion';
import { Query } from 'appwrite';

interface TeamData {
  $id: string;
  name: string;
  teamName: string;
  status: string;
  membersCount: number;
  idea_title: string;
  institutionName: string;
  team_code?: string;
}

export default function TeamDashboard() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [teamData, setTeamData] = useState<TeamData | null>(null);

  const [config, setConfig] = useState({ submissions: false });

  useEffect(() => {
    const checkAuth = async () => {
      const user = await authHelpers.getCurrentUser();
      if (!user) {
        router.push('/auth/login');
        return;
      }
      const role = authHelpers.getUserRole(user);
      if (!role || role !== UserRole.TEAM_LEAD) {
        router.push(role ? authHelpers.getRoleDashboard(role) : '/auth/login');
        return;
      }

      // Fetch config
      try {
        const confRes = await fetch('/api/admin/config');
        const confData = await confRes.json();
        if (confData.success && confData.config) {
          setConfig({
            submissions: confData.config.submissions || false
          });
        }
      } catch (e) {
        console.error("Failed to load config");
      }

      // Fetch team data
      try {
        const teamsResponse = await databases.listDocuments(
          DATABASE_ID,
          COLLECTIONS.TEAMS,
          [Query.equal('leader_user_id', user.$id)]
        );

        if (teamsResponse.total > 0) {
          setTeamData(teamsResponse.documents[0] as any);
        }
      } catch (error) {
        console.error('Error fetching team data:', error);
      }

      setIsLoading(false);
    };
    checkAuth();
  }, [router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-6 py-12">
      <FadeIn>
        <div className="space-y-2 mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Team Dashboard</h1>
          <p className="text-gray-600">Manage your team and submissions</p>
        </div>
      </FadeIn>

      <div className="grid md:grid-cols-2 gap-6">
        <SlideIn delay={0.1}>
          <Card className="border-gray-100">
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
              <CardDescription>Manage your team and submissions</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <motion.div whileHover={{ x: 4 }}>
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => router.push('/team/register')}
                  // Disable editing if shortlisted or beyond
                  disabled={teamData?.status === 'shortlisted' || teamData?.status === 'idea_submitted' || teamData?.status === 'selected'}
                >
                  <Users className="mr-2 h-4 w-4" />
                  {teamData?.teamName ? "Edit Team Details" : "Register Team"}
                </Button>
              </motion.div>
              <motion.div whileHover={{ x: 4 }}>
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => router.push('/team/questionnaire')}
                  // Disable questionnaire if not registered
                  disabled={!teamData?.teamName}
                >
                  <FileText className="mr-2 h-4 w-4" />
                  {teamData?.status === 'questionnaire_submitted' || teamData?.status === 'shortlisted' ? "View/Edit Questionnaire" : "Fill Questionnaire"}
                </Button>
              </motion.div>
              <motion.div whileHover={{ x: 4 }}>
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => router.push('/team/submit-idea')}
                  // Only allow submission if shortlisted and submissions open
                  disabled={!config.submissions || teamData?.status !== 'shortlisted'}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  {config.submissions
                    ? (teamData?.status !== 'shortlisted' ? "Shortlisting Required to Submit" : "Submit Idea")
                    : "Submissions Closed"}
                </Button>
              </motion.div>
            </CardContent>
          </Card>
        </SlideIn>

        <SlideIn delay={0.2}>
          <Card className="border-gray-100">
            <CardHeader>
              <CardTitle>Team Status</CardTitle>
              <CardDescription>Your current progress</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <StatusItem
                  label="Approval Status"
                  status={
                    teamData?.status === 'selected' ? "🏆 Selected for Final" :
                      teamData?.status === 'idea_submitted' ? "✓ Idea Submitted" :
                        teamData?.status === 'shortlisted' ? "⭐ Shortlisted" :
                          teamData?.status === 'questionnaire_submitted' ? "📝 Questionnaire Submitted" :
                            teamData?.status === 'registered' ? "👤 Registered" :
                              (teamData?.status === 'waitlisted' ? "• Waitlisted" : "Not Started")
                  }
                />
                <StatusItem
                  label="Team Name"
                  status={teamData?.teamName || "Not Set"}
                />
                <StatusItem
                  label="Team Members"
                  status={teamData ? `${teamData.membersCount}/5 Added` : "0/5 Added"}
                />
                <StatusItem
                  label="Idea Title"
                  status={teamData?.idea_title || "Not Set"}
                />
                <StatusItem
                  label="Team Code"
                  status={teamData?.team_code || "Not Generated"}
                />
                <StatusItem
                  label="Institution"
                  status={teamData?.institutionName || "N/A"}
                />
              </div>
            </CardContent>
          </Card>
        </SlideIn>
      </div>
    </div>
  );
}

function StatusItem({ label, status }: { label: string; status: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-sm text-gray-600">{label}</span>
      <span className="text-sm font-medium">{status}</span>
    </div>
  );
}