import { haysSource } from '../src/sources/hays.js';
import { advancetrsSource } from '../src/sources/advancetrs.js';
import { icerecruitSource } from '../src/sources/icerecruit.js';
import { morsonSource } from '../src/sources/morson.js';
import { matchtechSource } from '../src/sources/matchtech.js';

const search = {
  id: 'probe',
  keywords: ['BIM'],
  query: 'BIM',
  location: 'London',
  distance_from_location: 30,
};

const sources = [haysSource, advancetrsSource, icerecruitSource, morsonSource, matchtechSource];

for (const source of sources) {
  try {
    const jobs = await source.fetchJobs(search);
    console.log(source.name, jobs.length, jobs[0]?.title ?? '-', jobs[0]?.url?.slice(0, 80) ?? '-');
  } catch (err) {
    console.log(source.name, 'ERROR', err.message);
  }
}
