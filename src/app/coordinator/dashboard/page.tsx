// src/app/coordinator/dashboard/page.tsx - Coordinator Dashboard
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FadeIn } from '@/components/animations/FadeIn';
import { SlideIn } from '@/components/animations/SlideIn';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { authHelpers, UserRole } from '@/lib/appwrite';
import { Search, Building2, MapPin, Users, TrendingUp, Filter } from 'lucide-react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';

interface Team {
  id: string;
  teamName: string;
  institutionName: string;
  institutionId: string;
  district: string;
  status: string;
  teamCode: string;
  teamLeadName: string;
  teamLeadEmail: string;
  membersCount: number;
}

interface Statistics {
  byDistrict: Record<string, number>;
  byInstitution: Array<{
    institutionId: string;
    institutionName: string;
    district: string;
    count: number;
  }>;
  byStatus: Record<string, number>;
}

export default function CoordinatorDashboard() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [districtFilter, setDistrictFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [teams, setTeams] = useState<Team[]>([]);
  const [statistics, setStatistics] = useState<Statistics | null>(null);

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
        setStatistics(data.statistics);
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

  // Filter teams based on search query, district, and status
  const filteredTeams = teams.filter((team) => {
    const query = searchQuery.toLowerCase();
    const matchesSearch = 
      team.teamName.toLowerCase().includes(query) ||
      team.institutionName.toLowerCase().includes(query) ||
      team.teamLeadName.toLowerCase().includes(query) ||
      team.teamLeadEmail.toLowerCase().includes(query) ||
      (team.teamCode && team.teamCode.toLowerCase().includes(query));
    
    const matchesDistrict = districtFilter === 'all' || team.district === districtFilter;
    const matchesStatus = statusFilter === 'all' || team.status === statusFilter;
    
    return matchesSearch && matchesDistrict && matchesStatus;
  });

  // Get unique districts for filter
  const uniqueDistricts = Array.from(new Set(teams.map(t => t.district))).sort();
  const uniqueStatuses = Array.from(new Set(teams.map(t => t.status))).sort();

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
          <p className="text-gray-600">View and manage all team registrations</p>
        </div>
      </FadeIn>

      {/* Statistics Cards */}
      {statistics && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <SlideIn delay={0.1}>
            <Card className="border-gray-100">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Total Teams</p>
                    <p className="text-3xl font-bold">{teams.length}</p>
                  </div>
                  <Users className="h-8 w-8 text-blue-500" />
                </div>
              </CardContent>
            </Card>
          </SlideIn>

          <SlideIn delay={0.15}>
            <Card className="border-gray-100">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Districts</p>
                    <p className="text-3xl font-bold">{Object.keys(statistics.byDistrict).length}</p>
                  </div>
                  <MapPin className="h-8 w-8 text-green-500" />
                </div>
              </CardContent>
            </Card>
          </SlideIn>

          <SlideIn delay={0.2}>
            <Card className="border-gray-100">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Institutions</p>
                    <p className="text-3xl font-bold">{statistics.byInstitution.length}</p>
                  </div>
                  <Building2 className="h-8 w-8 text-purple-500" />
                </div>
              </CardContent>
            </Card>
          </SlideIn>

          <SlideIn delay={0.25}>
            <Card className="border-gray-100">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Nominated</p>
                    <p className="text-3xl font-bold">{statistics.byStatus['registered'] || 0}</p>
                  </div>
                  <TrendingUp className="h-8 w-8 text-orange-500" />
                </div>
              </CardContent>
            </Card>
          </SlideIn>
        </div>
      )}

      {/* District Statistics */}
      {statistics && statistics.byDistrict && (
        <SlideIn delay={0.3}>
          <Card className="border-gray-100 mb-6">
            <CardHeader>
              <CardTitle>Registrations by District</CardTitle>
              <CardDescription>Team distribution across districts</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {Object.entries(statistics.byDistrict)
                  .sort((a, b) => b[1] - a[1])
                  .map(([district, count]) => (
                    <div key={district} className="p-3 bg-gray-50 rounded-lg">
                      <p className="text-xs text-gray-600 truncate" title={district}>{district}</p>
                      <p className="text-2xl font-bold text-gray-900">{count}</p>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        </SlideIn>
      )}

      {/* Institution Statistics */}
      {statistics && statistics.byInstitution && (
        <SlideIn delay={0.35}>
          <Card className="border-gray-100 mb-6">
            <CardHeader>
              <CardTitle>Registrations by Institution</CardTitle>
              <CardDescription>Top institutions by team count</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {statistics.byInstitution
                  .sort((a, b) => b.count - a.count)
                  .map((inst) => (
                    <div key={inst.institutionId} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{inst.institutionName}</p>
                        <p className="text-xs text-gray-500">{inst.district}</p>
                      </div>
                      <span className="ml-4 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-semibold">
                        {inst.count}
                      </span>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        </SlideIn>
      )}

      {/* Search and Filters */}
      <SlideIn delay={0.4}>
        <Card className="border-gray-100 mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-5 w-5" />
              Search & Filter Teams
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Search by name, email, code..."
                  className="pl-10"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <Select value={districtFilter} onValueChange={setDistrictFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by District" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Districts</SelectItem>
                  {uniqueDistricts.map((district) => (
                    <SelectItem key={district} value={district}>
                      {district}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {uniqueStatuses.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status.charAt(0).toUpperCase() + status.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(searchQuery || districtFilter !== 'all' || statusFilter !== 'all') && (
              <p className="text-sm text-gray-500 mt-3">
                Showing {filteredTeams.length} of {teams.length} teams
              </p>
            )}
          </CardContent>
        </Card>
      </SlideIn>

      {/* Teams Grid */}
      {isFetching ? (
        <SlideIn delay={0.5}>
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
        <SlideIn delay={0.5}>
          <Card className="border-gray-100">
            <CardContent className="py-12">
              <p className="text-gray-600 text-center">
                {searchQuery || districtFilter !== 'all' || statusFilter !== 'all'
                  ? 'No teams match your filters'
                  : 'No teams found'}
              </p>
            </CardContent>
          </Card>
        </SlideIn>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredTeams.map((team, index) => (
            <SlideIn key={team.id} delay={0.02 * (index + 1)}>
              <motion.div
                whileHover={{ y: -4, scale: 1.02 }}
                transition={{ type: 'spring', stiffness: 300 }}
                className="h-full"
              >
                <Card
                  className="border-gray-100 hover:shadow-lg transition-shadow rounded-xl overflow-hidden cursor-pointer h-full"
                  onClick={() => handleTeamClick(team.id)}
                >
                  <CardHeader className="bg-gradient-to-br from-gray-50 to-white p-4">
                    <div className="space-y-3">
                      {/* Status Badge */}
                      <div className="flex justify-between items-start">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                          team.status === 'registered' 
                            ? 'bg-green-100 text-green-800'
                            : team.status === 'submitted'
                            ? 'bg-blue-100 text-blue-800'
                            : team.status === 'waitlisted'
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}>
                          {team.status}
                        </span>
                        <span className="text-xs text-gray-500">{team.membersCount} members</span>
                      </div>
                      
                      <CardTitle className="text-sm font-bold line-clamp-2">
                        {team.teamName}
                      </CardTitle>
                      
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5 text-xs text-gray-600">
                          <Building2 className="h-3.5 w-3.5 shrink-0" />
                          <span className="line-clamp-1">{team.institutionName}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-gray-600">
                          <MapPin className="h-3.5 w-3.5 shrink-0" />
                          <span className="line-clamp-1">{team.district}</span>
                        </div>
                      </div>
                      
                      {team.teamCode && (
                        <div className="text-xs text-blue-600 font-mono bg-blue-50 px-2 py-1 rounded w-fit">
                          {team.teamCode}
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
