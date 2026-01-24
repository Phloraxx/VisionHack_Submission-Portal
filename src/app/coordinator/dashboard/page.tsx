// src/app/coordinator/dashboard/page.tsx - Coordinator Dashboard
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FadeIn } from '@/components/animations/FadeIn';
import { SlideIn } from '@/components/animations/SlideIn';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { authHelpers, UserRole } from '@/lib/appwrite';
import { Search, Building2, MapPin, Users, TrendingUp, Filter, Mail, Phone } from 'lucide-react';
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

interface Institution {
  id: string;
  name: string;
  code: string;
  district: string;
  email: string;
  campusLeadName: string;
  campusLeadEmail: string;
  totalTeams: number;
  registeredTeams: number;
  waitlistedTeams: number;
  submittedTeams: number;
  maxTeams: number;
  status: string;
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

type ViewMode = 'teams' | 'institutions';

export default function CoordinatorDashboard() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('teams');
  const [searchQuery, setSearchQuery] = useState('');
  const [districtFilter, setDistrictFilter] = useState<string>('all');
  const [institutionFilter, setInstitutionFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [teams, setTeams] = useState<Team[]>([]);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
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

      // Fetch data
      await Promise.all([fetchTeams(), fetchInstitutions()]);
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

  const fetchInstitutions = async () => {
    try {
      const response = await fetch('/api/coordinator/institutions');
      const data = await response.json();

      if (data.success) {
        setInstitutions(data.institutions);
      } else {
        toast.error(data.error || 'Failed to fetch institutions');
      }
    } catch (error: any) {
      console.error('Error fetching institutions:', error);
      toast.error('Failed to load institutions');
    }
  };

  // Filter teams based on search query, district, institution, and status
  const filteredTeams = teams.filter((team) => {
    const query = searchQuery.toLowerCase();
    const matchesSearch = 
      team.teamName.toLowerCase().includes(query) ||
      team.institutionName.toLowerCase().includes(query) ||
      team.teamLeadName.toLowerCase().includes(query) ||
      team.teamLeadEmail.toLowerCase().includes(query) ||
      (team.teamCode && team.teamCode.toLowerCase().includes(query));
    
    const matchesDistrict = districtFilter === 'all' || team.district === districtFilter;
    const matchesInstitution = institutionFilter === 'all' || team.institutionId === institutionFilter;
    const matchesStatus = statusFilter === 'all' || team.status === statusFilter;
    
    return matchesSearch && matchesDistrict && matchesInstitution && matchesStatus;
  });

  // Filter institutions based on search and district
  const filteredInstitutions = institutions.filter((inst) => {
    const query = searchQuery.toLowerCase();
    const matchesSearch = 
      inst.name.toLowerCase().includes(query) ||
      inst.campusLeadName.toLowerCase().includes(query) ||
      inst.campusLeadEmail.toLowerCase().includes(query);
    
    const matchesDistrict = districtFilter === 'all' || inst.district === districtFilter;
    
    return matchesSearch && matchesDistrict;
  });

  // Calculate statistics based on current filters
  const filteredStats = {
    totalTeams: filteredTeams.length,
    totalInstitutions: viewMode === 'institutions' 
      ? filteredInstitutions.length
      : new Set(filteredTeams.map(t => t.institutionId)).size,
    registeredTeams: filteredTeams.filter(t => t.status === 'registered').length,
    waitlistedTeams: filteredTeams.filter(t => t.status === 'waitlisted').length,
    submittedTeams: filteredTeams.filter(t => t.status === 'submitted').length,
  };

  // Get unique districts and institutions for filters
  const uniqueDistricts = Array.from(new Set(teams.map(t => t.district))).sort();
  const uniqueStatuses = Array.from(new Set(teams.map(t => t.status))).sort();
  const uniqueInstitutions = Array.from(
    new Map(teams.map(t => [t.institutionId, { id: t.institutionId, name: t.institutionName }])).values()
  ).sort((a, b) => a.name.localeCompare(b.name));

  const handleTeamClick = (teamId: string) => {
    router.push(`/coordinator/teams/${teamId}`);
  };

  const handleInstitutionClick = (institutionId: string) => {
    setInstitutionFilter(institutionId);
    setViewMode('teams');
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
          <p className="text-gray-600">View and manage all team registrations and institutions</p>
        </div>
      </FadeIn>

      {/* District Filter - Top Level */}
      <SlideIn delay={0.05}>
        <Card className="border-gray-100 mb-6">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <MapPin className="h-5 w-5 text-gray-600" />
              <div className="flex-1">
                <Select value={districtFilter} onValueChange={setDistrictFilter}>
                  <SelectTrigger className="w-full md:w-64">
                    <SelectValue placeholder="Select District" />
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
              </div>
              {districtFilter !== 'all' && (
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setDistrictFilter('all')}
                >
                  Clear Filter
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </SlideIn>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <SlideIn delay={0.1}>
          <Card className="border-gray-100">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Total Teams</p>
                  <p className="text-3xl font-bold">{filteredStats.totalTeams}</p>
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
                  <p className="text-sm text-gray-600">Institutions</p>
                  <p className="text-3xl font-bold">{filteredStats.totalInstitutions}</p>
                </div>
                <Building2 className="h-8 w-8 text-purple-500" />
              </div>
            </CardContent>
          </Card>
        </SlideIn>

        <SlideIn delay={0.2}>
          <Card className="border-gray-100">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Registered</p>
                  <p className="text-3xl font-bold">{filteredStats.registeredTeams}</p>
                </div>
                <TrendingUp className="h-8 w-8 text-green-500" />
              </div>
            </CardContent>
          </Card>
        </SlideIn>
      </div>

      {/* View Mode Toggle */}
      <SlideIn delay={0.25}>
        <Card className="border-gray-100 mb-6">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Filter className="h-5 w-5 text-gray-600" />
                <span className="font-medium">View:</span>
              </div>
              <div className="flex gap-2">
                <Button
                  variant={viewMode === 'teams' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setViewMode('teams')}
                >
                  <Users className="h-4 w-4 mr-2" />
                  Teams
                </Button>
                <Button
                  variant={viewMode === 'institutions' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setViewMode('institutions')}
                >
                  <Building2 className="h-4 w-4 mr-2" />
                  Institutions
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </SlideIn>

      {/* Search and Additional Filters */}
      <SlideIn delay={0.3}>
        <Card className="border-gray-100 mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              Search & Filter
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  placeholder={viewMode === 'teams' ? "Search teams..." : "Search institutions..."}
                  className="pl-10"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              {viewMode === 'teams' && (
                <>
                  <Select value={institutionFilter} onValueChange={setInstitutionFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="Filter by Institution" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Institutions</SelectItem>
                      {uniqueInstitutions.map((inst) => (
                        <SelectItem key={inst.id} value={inst.id}>
                          {inst.name}
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
                </>
              )}
            </div>
            {(searchQuery || institutionFilter !== 'all' || statusFilter !== 'all') && viewMode === 'teams' && (
              <p className="text-sm text-gray-500 mt-3">
                Showing {filteredTeams.length} of {teams.length} teams
              </p>
            )}
            {searchQuery && viewMode === 'institutions' && (
              <p className="text-sm text-gray-500 mt-3">
                Showing {filteredInstitutions.length} of {institutions.length} institutions
              </p>
            )}
          </CardContent>
        </Card>
      </SlideIn>

      {/* Content Grid */}
      {isFetching ? (
        <SlideIn delay={0.35}>
          <Card className="border-gray-100">
            <CardContent className="py-12">
              <div className="text-center">
                <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]" />
                <p className="text-gray-600 mt-4">Loading data...</p>
              </div>
            </CardContent>
          </Card>
        </SlideIn>
      ) : viewMode === 'teams' ? (
        filteredTeams.length === 0 ? (
          <SlideIn delay={0.35}>
            <Card className="border-gray-100">
              <CardContent className="py-12">
                <p className="text-gray-600 text-center">
                  No teams match your filters
                </p>
              </CardContent>
            </Card>
          </SlideIn>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredTeams.map((team, index) => (
              <SlideIn key={team.id} delay={0.01 * (index + 1)}>
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
        )
      ) : (
        filteredInstitutions.length === 0 ? (
          <SlideIn delay={0.35}>
            <Card className="border-gray-100">
              <CardContent className="py-12">
                <p className="text-gray-600 text-center">
                  No institutions match your filters
                </p>
              </CardContent>
            </Card>
          </SlideIn>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredInstitutions.map((inst, index) => (
              <SlideIn key={inst.id} delay={0.01 * (index + 1)}>
                <motion.div
                  whileHover={{ y: -4, scale: 1.02 }}
                  transition={{ type: 'spring', stiffness: 300 }}
                  className="h-full"
                >
                  <Card
                    className="border-gray-100 hover:shadow-lg transition-shadow rounded-xl overflow-hidden cursor-pointer h-full"
                    onClick={() => handleInstitutionClick(inst.id)}
                  >
                    <CardHeader className="bg-gradient-to-br from-purple-50 to-white p-5">
                      <div className="space-y-4">
                        <div>
                          <CardTitle className="text-base font-bold line-clamp-2 mb-2">
                            {inst.name}
                          </CardTitle>
                          <div className="flex items-center gap-1.5 text-xs text-gray-600">
                            <MapPin className="h-3.5 w-3.5 shrink-0" />
                            <span>{inst.district}</span>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="p-2 bg-blue-50 rounded">
                            <p className="text-xs text-gray-600">Total Teams</p>
                            <p className="text-lg font-bold text-blue-600">{inst.totalTeams}</p>
                          </div>
                          <div className="p-2 bg-green-50 rounded">
                            <p className="text-xs text-gray-600">Nominated</p>
                            <p className="text-lg font-bold text-green-600">{inst.registeredTeams}/{inst.maxTeams}</p>
                          </div>
                          <div className="p-2 bg-yellow-50 rounded">
                            <p className="text-xs text-gray-600">Waitlisted</p>
                            <p className="text-lg font-bold text-yellow-600">{inst.waitlistedTeams}</p>
                          </div>
                          <div className="p-2 bg-purple-50 rounded">
                            <p className="text-xs text-gray-600">Submitted</p>
                            <p className="text-lg font-bold text-purple-600">{inst.submittedTeams}</p>
                          </div>
                        </div>

                        <div className="pt-3 border-t border-gray-200 space-y-2">
                          <p className="text-xs font-medium text-gray-700">Campus Lead</p>
                          <p className="text-sm font-semibold text-gray-900">{inst.campusLeadName}</p>
                          <div className="flex items-center gap-1.5 text-xs text-gray-600">
                            <Mail className="h-3 w-3 shrink-0" />
                            <span className="truncate">{inst.campusLeadEmail}</span>
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                  </Card>
                </motion.div>
              </SlideIn>
            ))}
          </div>
        )
      )}
    </div>
  );
}
