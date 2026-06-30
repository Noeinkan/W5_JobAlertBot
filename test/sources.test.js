import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { haysSource } from '../src/sources/hays.js';
import { advancetrsSource } from '../src/sources/advancetrs.js';
import { icerecruitSource } from '../src/sources/icerecruit.js';
import { morsonSource } from '../src/sources/morson.js';
import { matchtechSource } from '../src/sources/matchtech.js';

const advanceSample = `
<article class="job type-job job-type-permanent">
<div class="job-heading"><h3 class="mb-2"><a href="https://www.advance-trs.com/job/bim-coordinator-14/">BIM Coordinator</a></h3>
<time datetime="2026-06-30">Posted 4 hours ago</time></div>
<div class="job-content">
<ul><li class="location">Bristol</li><li class="salary">£40000</li><li> - £50000</li></ul>
<p>BIM Coordinator for infrastructure delivery</p>
<ul class="meta"><li class="job-type permanent">Permanent</li></ul>
</div></article>
`;

const iceSample = `
<div class="lister__item cf" id="item-232184">
<h3 class="lister__header"><a href="/job/232184/bim-coordinator-contract/"><span>BIM Coordinator - Contract</span></a></h3>
<ul class="lister__meta">
<li class="lister__meta-item lister__meta-item--location">London</li>
<li class="lister__meta-item lister__meta-item--salary">£250 per day</li>
<li class="lister__meta-item lister__meta-item--recruiter">Conrad Consulting Ltd.</li>
</ul></div>
`;

const morsonSample = `
<script type="application/ld+json">{"@type":"ItemList","itemListElement":[{"@type":"JobPosting","title":"BIM Manager","datePosted":"2026-06-30","employmentType":"CONTRACTOR","identifier":"https://www.morson.com/jobs/bim-manager","description":"Lead BIM delivery","jobLocation":{"name":"London"},"hiringOrganization":{"name":"Morson Group"},"baseSalary":{"value":{"minValue":"500","maxValue":"600","unitText":"DAY"}}}]}</script>
`;

const matchtechSample = `
<li class="job-data " id="job-6155"><a href="/job/606758/commercial--contracts-manager/">
<span class="post-date">23 Jun 2026</span><span class="job-ref">606758</span>
<div class="xs-heading"><span>BIM Manager</span></div>
<ul class="job-data-highlights"><li><i class="icon money"></i><span>£70,000</span></li>
<li><i class="icon location"></i><span>London</span></li></ul></li>
`;

describe('new UK recruiter sources', () => {
  it('source adapters are configured without API keys', () => {
    assert.equal(haysSource.isConfigured(), true);
    assert.equal(advancetrsSource.isConfigured(), true);
    assert.equal(icerecruitSource.isConfigured(), true);
    assert.equal(morsonSource.isConfigured(), true);
    assert.equal(matchtechSource.isConfigured(), true);
  });

  it('advance TRS article parser finds BIM Coordinator', () => {
    const articles = advanceSample.split('<article').slice(1);
    assert.equal(articles.length, 1);
    const title = articles[0].match(/<h3[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    assert.match(title[2].replace(/<[^>]+>/g, ''), /BIM Coordinator/);
  });

  it('ICE Recruit lister item contains job link', () => {
    const block = iceSample.split(/class="lister__item/).slice(1)[0];
    const titleLink = block.match(/<h3 class="lister__header"><a[\s\S]*?href="\s*([^"]+?)\s*"[\s\S]*?><span>([^<]+)<\/span>/);
    assert.equal(titleLink[2], 'BIM Coordinator - Contract');
  });

  it('Morson JSON-LD item list yields a job posting', () => {
    const blocks = [...morsonSample.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    const data = JSON.parse(blocks[0][1]);
    assert.equal(data.itemListElement[0].title, 'BIM Manager');
  });

  it('Matchtech job-data block exposes title and ref', () => {
    const title = matchtechSample.match(/class="xs-heading"[^>]*>\s*<span>([^<]+)<\/span>/);
    const ref = matchtechSample.match(/class="job-ref"[^>]*>([^<]+)/);
    assert.equal(title[1], 'BIM Manager');
    assert.equal(ref[1], '606758');
  });
});
