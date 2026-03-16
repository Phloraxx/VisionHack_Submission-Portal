'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { LogOut, Menu } from 'lucide-react';
import { authHelpers } from '@/lib/appwrite';
import { toast } from 'sonner';
import { useEffect, useState } from 'react';
import Image from 'next/image';

export function Header() {
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      const user = await authHelpers.getCurrentUser();
      setIsLoggedIn(!!user);
    };
    checkAuth();
  }, []);

  const handleLogout = async () => {
    try {
      await authHelpers.logout();
      toast.success('Logged out successfully');
      setIsLoggedIn(false);
      router.push('/auth/login');
    } catch (error) {
      console.error('Logout error:', error);
      toast.error('Failed to logout');
    }
  };

  return (
    <motion.header
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
      className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100"
    >
      <div className="container mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center space-x-2">
            <motion.div
              whileHover={{ scale: 1.05 }}
              transition={{ type: 'spring', stiffness: 400 }}
            >
              <span className="text-2xl font-bold tracking-tight">Vision Hack 2026</span>
            </motion.div>
          </Link>

          <nav className="hidden md:flex items-center space-x-1">
          </nav>

          {/* Centered Logo */}
          <div className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2">
            <div className="relative h-12 w-48 overflow-hidden select-none">
              <Image
                src="/logo.jpeg"
                alt="Logo"
                fill
                className="object-contain" // Use object-contain to fit long horizontal logo
              />
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <Button variant="ghost" size="icon" className="md:hidden" aria-label="Toggle menu">
              <Menu className="h-5 w-5" />
            </Button>
            {isLoggedIn && (
              <Button
                variant="ghost"
                onClick={handleLogout}
                className="flex items-center gap-2"
              >
                <LogOut className="h-5 w-5" />
                <span className="hidden md:inline">Logout</span>
              </Button>
            )}
          </div>
        </div>
      </div>
    </motion.header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href}>
      <motion.div
        whileHover={{ y: -2 }}
        transition={{ type: 'spring', stiffness: 400 }}
        className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-black transition-colors"
      >
        {children}
      </motion.div>
    </Link>
  );
}
