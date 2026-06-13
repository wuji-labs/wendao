import { z } from 'zod'
import { router, publicProcedure } from '../middleware.js'
import { minuteRouter } from './minute.js'
import { transcriptRouter } from './transcript.js'
import { speakerRouter } from './speaker.js'
import { collabRouter } from './collab.js'
import { aiRouter } from './ai.js'
import { qaRouter } from './qa.js'
import { folderRouter } from './folder.js'
import { translationRouter } from './translation.js'
import { exportRouter } from './export.js'
import { voiceprintRouter } from './voiceprint.js'

export const appRouter = router({
  ping: publicProcedure.input(z.object({ message: z.string() }).optional()).query(({ input }) => ({
    pong: true,
    echo: input?.message ?? '妙记',
    timestamp: new Date().toISOString()
  })),

  minute: minuteRouter,
  transcript: transcriptRouter,
  speaker: speakerRouter,
  collab: collabRouter,
  ai: aiRouter,
  qa: qaRouter,
  folder: folderRouter,
  translation: translationRouter,
  export: exportRouter,
  voiceprint: voiceprintRouter
})

export type AppRouter = typeof appRouter
