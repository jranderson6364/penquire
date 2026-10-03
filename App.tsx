import { StatusBar } from 'expo-status-bar';
import * as React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { HomeScreen } from './src/screens/HomeScreen';
import { NewAssignmentScreen } from './src/screens/NewAssignmentScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { WorkspaceScreen } from './src/screens/WorkspaceScreen';

type Route = { name: 'home' } | { name: 'new' } | { name: 'settings' } | { name: 'workspace'; id: string };

export default function App() {
  const [route, setRoute] = React.useState<Route>({ name: 'home' });
  const home = () => setRoute({ name: 'home' });

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {route.name === 'home' && (
        <HomeScreen
          onOpen={(id) => setRoute({ name: 'workspace', id })}
          onNew={() => setRoute({ name: 'new' })}
          onSettings={() => setRoute({ name: 'settings' })}
        />
      )}
      {route.name === 'new' && <NewAssignmentScreen onCancel={home} onCreated={(id) => setRoute({ name: 'workspace', id })} />}
      {route.name === 'settings' && <SettingsScreen onDone={home} />}
      {route.name === 'workspace' && <WorkspaceScreen key={route.id} assignmentId={route.id} onBack={home} />}
    </SafeAreaProvider>
  );
}
