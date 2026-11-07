import {lstatSync} from 'node:fs';
import {ServiceError} from './files.mjs';
import {MAX_FILE_BYTES,formatFileLimit} from './schemas.mjs';
import {executePhoto,photoSchema} from './photo.mjs';
import {executeWord,wordSchema} from './word.mjs';
import {executeDeck,deckSchema} from './deck.mjs';
import {executeVector,vectorSchema} from './vector.mjs';
import {executeFig,figSchema} from './fig.mjs';
import {executeCad,cadSchema} from './cad.mjs';
import {executeDesign,designSchema} from './design.mjs';
import {executeLight,lightSchema} from './light.mjs';
import {executeSound,soundSchema} from './sound.mjs';
import {executeFilm,filmSchema} from './film.mjs';
import {executeEffect,effectSchema} from './effect.mjs';

export const editorJobs = {
 photo: {binary:'photocraft-cli',schema:photoSchema,execute:executePhoto},
 word: {binary:'wordcraft-cli',schema:wordSchema,execute:executeWord},
 deck: {binary:'deckcraft-cli',schema:deckSchema,execute:executeDeck},
 vector: {binary:'vectorcraft-cli',schema:vectorSchema,execute:executeVector},
 fig: {binary:'figcraft-cli',schema:figSchema,execute:executeFig},
 cad: {binary:'cadcraft-cli',schema:cadSchema,execute:executeCad},
 design: {binary:'designcraft-cli',schema:designSchema,execute:executeDesign},
 light: {binary:'lightcraft-cli',schema:lightSchema,execute:executeLight},
 sound: {binary:'soundcraft-cli',schema:soundSchema,execute:executeSound},
 film: {binary:'filmcraft-cli',schema:filmSchema,execute:executeFilm},
 effect: {binary:'effectcraft-cli',schema:effectSchema,execute:executeEffect},
};

export function assertOutput(path,maxFileBytes=MAX_FILE_BYTES) {
 let stat;
 try { stat=lstatSync(path); } catch { throw new ServiceError('The engine did not produce an output file.'); }
 if (!stat.isFile() || stat.nlink!==1 || stat.size===0) throw new ServiceError('The engine produced an invalid output file.');
 if (stat.size>maxFileBytes) throw new ServiceError(`Task output exceeds ${formatFileLimit(maxFileBytes)}.`);
}
