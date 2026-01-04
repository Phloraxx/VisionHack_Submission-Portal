// Team Details Page for Coordinator
'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { FadeIn } from '@/components/animations/FadeIn';
import { SlideIn } from '@/components/animations/SlideIn';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { authHelpers, UserRole } from '@/lib/appwrite';
import { ArrowLeft, Building2, Users, Mail, Phone, User, Lightbulb, Code, Award, Calendar, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

interface TeamMember {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  gender: string;
  role: string;
}

interface Institution {
  id: string;
  name: string;
  code: string;
  campusLeadName: string;
  campusLeadEmail: string;
}

interface TeamDetails {
  id: string;
  teamName: string;
  ideaTitle: string;
  ideaDesc: string;
  techStack: string;
  status: string;
  teamLeadEmail: string;
  teamLeadName: string;
  leaderUserId: string;
  createdAt: string;
  updatedAt: string;
  mentorName: string;
  mentorContact: string;
  submissionFileId: string;
  institution: Institution | null;
  institutionName: string;
  members: TeamMember[];
  membersCount: number;
  teamCode: string;
}

export default function TeamDetailsPage() {
  const router = useRouter();
  const params = useParams();
  const teamId = params.teamId as string;

  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(true);
  const [team, setTeam] = useState<TeamDetails | null>(null);

  useEffect(() => {
    const checkAuth = async () => {
      const user = await authHelpers.getCurrentUser();
      if (!user) {
        router.push('/auth/login');
        return;
      }
      const role = authHelpers.getUserRole(user);
      if (!role || role !== UserRole.COORDINATOR) {
        router.push(role ? authHelpers.getRoleDashboard(role) : '/auth/login');
        return;
      }
      setIsLoading(false);

      // Fetch team details
      await fetchTeamDetails();
    };
    checkAuth();
  }, [router, teamId]);

  const fetchTeamDetails = async () => {
    setIsFetching(true);
    try {
      const response = await fetch(`/api/coordinator/teams/${teamId}`);
      const data = await response.json();

      if (data.success) {
        setTeam(data.team);
      } else {
        toast.error(data.error || 'Failed to fetch team details');
      }
    } catch (error: any) {
      console.error('Error fetching team details:', error);
      toast.error('Failed to load team details');
    } finally {
      setIsFetching(false);
    }
  };

  if (isLoading || isFetching) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]" />
          <p className="text-gray-600 mt-4">Loading team details...</p>
        </div>
      </div>
    );
  }

  if (!team) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">Team not found</p>
          <Button onClick={() => router.push('/coordinator/dashboard')} className="mt-4">
            Back to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-6 py-12">
      <FadeIn>
        <Button
          variant="ghost"
          onClick={() => router.push('/coordinator/dashboard')}
          className="mb-6"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Dashboard
        </Button>
      </FadeIn>

      <FadeIn>
        <div className="space-y-2 mb-8">
          <h1 className="text-3xl font-bold tracking-tight">{team.teamName}</h1>
          <div className="flex items-center gap-4 text-gray-600">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              <span>{team.institutionName}</span>
            </div>
            <div className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
              {team.status}
            </div>
          </div>
        </div>
      </FadeIn>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Team Information */}
        <SlideIn delay={0.1}>
          <Card className="border-gray-100">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lightbulb className="h-5 w-5" />
                Team Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-1">Idea Title</h4>
                    <p className="text-gray-900 font-medium">{team.ideaTitle}</p>
                  </div>
                  {team.submissionFileId && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-blue-600 border-blue-200 hover:bg-blue-50"
                      onClick={() => {
                        const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
                        const fileUrl = `${endpoint}/storage/buckets/${process.env.NEXT_PUBLIC_APPWRITE_SUBMISSIONS_BUCKET_ID}/files/${team.submissionFileId}/view?project=${process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID}`;
                        window.open(fileUrl, '_blank');
                      }}
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      View Submission
                    </Button>
                  )}
                </div>
                {team.teamCode && (
                  <div className="mt-2">
                    <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2 py-1 rounded">
                      Team Code: {team.teamCode}
                    </span>
                  </div>
                )}
              </div>

              {team.ideaDesc && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-1">Description</h4>
                  <p className="text-gray-600 text-sm leading-relaxed">{team.ideaDesc}</p>
                </div>
              )}

              {team.techStack && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-2">
                    <Code className="h-4 w-4" />
                    Tech Stack
                  </h4>
                  <p className="text-gray-600 text-sm">{team.techStack}</p>
                </div>
              )}

              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-1 flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Submitted On
                </h4>
                <p className="text-gray-600 text-sm">
                  {new Date(team.createdAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </p>
              </div>
            </CardContent>
          </Card>
        </SlideIn>

        {/* Institution & Lead Information */}
        <SlideIn delay={0.2}>
          <Card className="border-gray-100">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                Institution & Team Lead
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {team.institution && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">Institution</h4>
                  <div className="space-y-1">
                    <p className="text-gray-900">{team.institution.name}</p>
                    <p className="text-xs text-gray-500">Code: {team.institution.code}</p>
                  </div>
                </div>
              )}

              {team.institution && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-2">Campus Lead</h4>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm">
                      <User className="h-4 w-4 text-gray-500" />
                      <span>{team.institution.campusLeadName}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Mail className="h-4 w-4 text-gray-500" />
                      <span>{team.institution.campusLeadEmail}</span>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-2">Team Lead</h4>
                <div className="space-y-1">
                  {team.teamLeadName && (
                    <div className="flex items-center gap-2 text-sm">
                      <User className="h-4 w-4 text-gray-500" />
                      <span>{team.teamLeadName}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="h-4 w-4 text-gray-500" />
                    <span>{team.teamLeadEmail}</span>
                  </div>
                </div>
              </div>

              {(team.mentorName || team.mentorContact) && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                    <Award className="h-4 w-4" />
                    Mentor
                  </h4>
                  <div className="space-y-1">
                    {team.mentorName && (
                      <div className="flex items-center gap-2 text-sm">
                        <User className="h-4 w-4 text-gray-500" />
                        <span>{team.mentorName}</span>
                      </div>
                    )}
                    {team.mentorContact && (
                      <div className="flex items-center gap-2 text-sm">
                        <Mail className="h-4 w-4 text-gray-500" />
                        <span>{team.mentorContact}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </SlideIn>
      </div>

      {/* Team Members */}
      <SlideIn delay={0.3}>
        <Card className="border-gray-100 mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Team Members ({team.membersCount})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {team.members.length === 0 ? (
              <p className="text-gray-600 text-sm">No members registered</p>
            ) : (
              <div className="grid md:grid-cols-2 gap-4">
                {team.members.map((member, index) => (
                  <div
                    key={member.id}
                    className="border border-gray-100 rounded-lg p-4 hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <h4 className="font-semibold text-gray-900">{member.fullName}</h4>
                      <span className="text-xs bg-gray-100 px-2 py-1 rounded">
                        Member {index + 1}
                      </span>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Mail className="h-4 w-4" />
                        <span className="break-all">{member.email}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Phone className="h-4 w-4" />
                        <span>{member.phone}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <User className="h-4 w-4" />
                        <span>{member.gender}</span>
                      </div>
                      <div className="mt-2 pt-2 border-t border-gray-100">
                        <span className="text-xs font-medium text-gray-700">Role:</span>
                        <span className="text-xs text-gray-600 ml-2">{member.role}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </SlideIn>
    </div>
  );
}
