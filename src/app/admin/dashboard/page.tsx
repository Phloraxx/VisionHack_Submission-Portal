// src/app/admin/dashboard/page.tsx - Admin Dashboard
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FadeIn } from '@/components/animations/FadeIn';
import { SlideIn } from '@/components/animations/SlideIn';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { authHelpers, UserRole } from '@/lib/appwrite';
import { Settings, Database, Users, FileDown, ImagePlus, ToggleLeft, UserCog } from 'lucide-react';
import { motion } from 'framer-motion';

export default function AdminDashboard() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      const user = await authHelpers.getCurrentUser();
      if (!user) {
        router.push('/auth/login');
        return;
      }
      const role = authHelpers.getUserRole(user);
      if (!role || role !== UserRole.ADMIN) {
        router.push(role ? authHelpers.getRoleDashboard(role) : '/auth/login');
        return;
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
          <h1 className="text-3xl font-bold tracking-tight">Admin Dashboard</h1>
          <p className="text-gray-600">Governance, content management, and results</p>
        </div>
      </FadeIn>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        <SlideIn delay={0.1}>
          <AdminActionCard
            icon={UserCog}
            title="Create Campus Leads"
            description="Bulk upload CSV to create campus lead accounts"
            action={() => router.push('/admin/campus-leads')}
          />
        </SlideIn>

        <SlideIn delay={0.2}>
          <AdminActionCard
            icon={ToggleLeft}
            title="Event Configuration"
            description="Toggle registration, nomination, and submission windows"
            action={() => router.push('/admin/config')}
          />
        </SlideIn>

        <SlideIn delay={0.3}>
          <AdminActionCard
            icon={Users}
            title="View All Teams"
            description="Browse, search, and manage all registered teams"
            action={() => router.push('/admin/teams')}
          />
        </SlideIn>

        <SlideIn delay={0.4}>
          <AdminActionCard
            icon={FileDown}
            title="Export Data"
            description="Download team and member data as CSV"
            action={() => router.push('/admin/export')}
          />
        </SlideIn>
      </div>
    </div>
  );
}

function AdminActionCard({ icon: Icon, title, description, action }: any) {
  return (
    <motion.div whileHover={{ y: -4 }} transition={{ type: 'spring', stiffness: 300 }}>
      <Card className="h-full border-gray-100 hover:shadow-lg transition-shadow cursor-pointer" onClick={action}>
        <CardHeader>
          <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center mb-4">
            <Icon className="h-6 w-6" />
          </div>
          <CardTitle className="text-lg">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <CardDescription className="text-sm leading-relaxed">
            {description}
          </CardDescription>
        </CardContent>
      </Card>
    </motion.div>
  );
}