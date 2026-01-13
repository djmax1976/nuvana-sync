/**
 * Settings Page
 *
 * Application settings including file watcher configuration.
 * Wraps the existing Settings component for React Router.
 *
 * @module renderer/pages/SettingsPage
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import Settings from './Settings';

export default function SettingsPage() {
  const navigate = useNavigate();

  return <Settings onBack={() => navigate('/')} />;
}
