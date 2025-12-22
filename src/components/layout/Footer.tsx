'use client';

import { motion } from 'framer-motion';

export function Footer() {
  return (
    <footer className="border-t border-gray-100 bg-white">
      <div className="container mx-auto px-6 py-8">
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center text-sm text-gray-600"
        >
          <p>© 2026 Vision Hack. All rights reserved.</p>
        </motion.div>
      </div>
    </footer>
  );
}
