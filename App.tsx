import { StatusBar } from 'expo-status-bar';
import * as React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { HomeScreen } from './src/screens/HomeScreen';
import { IndependentScreen } from './src/screens/IndependentScreen';
import { NewAssignmentScreen } from './src/screens/NewAssignmentScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { WorkspaceScreen } from './src/screens/WorkspaceScreen';
import { applyAppearance } from './src/appearance';
import { getSettings } from './src/store/db';

// light / dark / system, before the first frame (colors are dynamic, so later changes apply instantly)
try {
  applyAppearance(getSettings().appearance);
} catch (e) {
  console.warn('settings not readable yet; using the system appearance', e);
}

type Route =
  | { name: 'home' }
  | { name: 'new' }
  | { name: 'settings' }
  | { name: 'workspace'; id: string }
  /** the fresh problem for an episode; the screen begins or resumes the attempt itself */
  | { name: 'independent'; episodeId: string };

export default function App() {
  const [route, setRoute] = React.useState<Route>({ name: 'home' });
  const home = () => setRoute({ name: 'home' });
  const toIndependent = (episodeId: string) => setRoute({ name: 'independent', episodeId });

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      {route.name === 'home' && (
        <HomeScreen
          onOpen={(id) => setRoute({ name: 'workspace', id })}
          onNew={() => setRoute({ name: 'new' })}
          onSettings={() => setRoute({ name: 'settings' })}
          onOpenIndependent={toIndependent}
        />
      )}
      {route.name === 'new' && <NewAssignmentScreen onCancel={home} onCreated={(id) => setRoute({ name: 'workspace', id })} />}
      {route.name === 'settings' && <SettingsScreen onDone={home} />}
      {route.name === 'workspace' && <WorkspaceScreen key={route.id} assignmentId={route.id} onBack={home} onStartIndependent={toIndependent} />}
      {route.name === 'independent' && <IndependentScreen key={route.episodeId} episodeId={route.episodeId} onDone={home} />}
    </SafeAreaProvider>
  );
}
