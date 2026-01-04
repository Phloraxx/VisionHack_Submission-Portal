// src/app/coordinator/dashboard/page.tsx - Coordinator Dashboard
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FadeIn } from '@/components/animations/FadeIn';
import { SlideIn } from '@/components/animations/SlideIn';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { authHelpers, UserRole } from '@/lib/appwrite';
import { Search, Building2 } from 'lucide-react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';

interface Team {
  id: string;
  teamName: string;
  institutionName: string;
  teamCode: string; // From API it might be teamCode or team_code mapped
}

export default function CoordinatorDashboard() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [teams, setTeams] = useState<Team[]>([]);
  // Track which team cards are expanded (by id)
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());

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

      // Fetch teams
      await fetchTeams();
    };
    checkAuth();
  }, [router]);

  const fetchTeams = async () => {
    setIsFetching(true);
    try {
      const response = await fetch('/api/coordinator/teams');
      const data = await response.json();

      if (data.success) {
        setTeams(data.teams);
      } else {
        toast.error(data.error || 'Failed to fetch teams');
      }
    } catch (error: any) {
      console.error('Error fetching teams:', error);
      toast.error('Failed to load teams');
    } finally {
      setIsFetching(false);
    }
  };

  const toggleTeamExpansion = (teamId: string) => {
    const newExpanded = new Set(expandedTeams);
    if (newExpanded.has(teamId)) {
      newExpanded.delete(teamId);
    } else {
      newExpanded.add(teamId);
    }
    setExpandedTeams(newExpanded);
  };

  // Filter teams based on search query
  const filteredTeams = teams.filter((team) => {
    const query = searchQuery.toLowerCase();
    return (
      team.teamName.toLowerCase().includes(query) ||
      team.institutionName.toLowerCase().includes(query) ||
      (team.teamCode && team.teamCode.includes(query))
    );
  });

  const handleTeamClick = (teamId: string) => {
    router.push(`/coordinator/teams/${teamId}`);
  };

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
          <h1 className="text-3xl font-bold tracking-tight">Coordinator Dashboard</h1>
          <p className="text-gray-600">View all submitted teams ({teams.length})</p>
        </div>
      </FadeIn>

      <SlideIn delay={0.2}>
        <Card className="border-gray-100 mb-6">
          <CardHeader>
            <CardTitle>Search Teams</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search by team name, code, institution, idea title, or email..."
                className="pl-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            {searchQuery && (
              <p className="text-sm text-gray-500 mt-2">
                Found {filteredTeams.length} {filteredTeams.length === 1 ? 'team' : 'teams'}
              </p>
            )}
          </CardContent>
        </Card>
      </SlideIn>

      {isFetching ? (
        <SlideIn delay={0.3}>
          <Card className="border-gray-100">
            <CardContent className="py-12">
              <div className="text-center">
                <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]" />
                <p className="text-gray-600 mt-4">Loading teams...</p>
              </div>
            </CardContent>
          </Card>
        </SlideIn>
      ) : filteredTeams.length === 0 ? (
        <SlideIn delay={0.3}>
          <Card className="border-gray-100">
            <CardContent className="py-12">
              <p className="text-gray-600 text-center">
                {searchQuery ? 'No teams match your search' : 'No submitted teams found'}
              </p>
            </CardContent>
          </Card>
        </SlideIn>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {filteredTeams.map((team, index) => (
            <SlideIn key={team.id} delay={0.05 * (index + 1)}>
              <motion.div
                whileHover={{ y: -4, scale: 1.02 }}
                transition={{ type: 'spring', stiffness: 300 }}
                className="h-full"
              >
                <Card
                  className="border-gray-100 hover:shadow-lg transition-shadow rounded-xl overflow-hidden cursor-pointer h-full"
                  onClick={() => handleTeamClick(team.id)}
                >
                  <CardHeader className="bg-linear-to-br from-gray-50 to-white p-4">
                    <div className="space-y-3">
                      <CardTitle className="text-sm font-bold line-clamp-2">
                        {team.teamName}
                      </CardTitle>
                      <div className="flex items-center gap-1.5 text-xs text-gray-600">
                        <Building2 className="h-3.5 w-3.5 shrink-0" />
                        <span className="line-clamp-1">{team.institutionName}</span>
                      </div>
                      {team.teamCode && (
                        <div className="text-xs text-blue-600 font-mono bg-blue-50 px-2 py-1 rounded w-fit">
                          Code: {team.teamCode}
                        </div>
                      )}
                    </div>
                  </CardHeader>
                </Card>
              </motion.div>
            </SlideIn>
          ))}
        </div>
      )}
    </div>
  );
}