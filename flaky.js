const {client} = require("./util.js")

async function run() {
  // set up restraints for pipelines
  const lookbackDays = 30
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - lookbackDays);

  // variable setup
  const branchesBuiltInLookback = new Set()
  let finishedGettingPipelines = false
  let pipelinePageToken = undefined

  // loop until we see an old dated pipeline
  while (!finishedGettingPipelines) {
    const pipelineResults = await client.get(
      'project', 
      'pipeline',
      {
        'page-token': pipelinePageToken,
      }
    )

    pipelinePageToken = pipelineResults.next_page_token

    // add pipeline branches to list to fetch tests for
    for (const pipeline of pipelineResults.items) {
      const pipelineDate = Date.parse(pipeline.updated_at)
      if (pipelineDate > startDate) {
        branchesBuiltInLookback.add(pipeline.vcs.branch)
      } else {
        finishedGettingPipelines = true
        break
      }
    }
  }

  // now that we have all recent branches, get all flaky tests
  // for those branches
  const flakyJobGroups = {}

  for (const branch of Array.from(branchesBuiltInLookback).slice(0, 1)) {
    const testResults = await client.get(
      'insights',
      'flaky-tests',
      {
        branch,
      },
    )
  
    // go through each flaky test
    for (const test of testResults.flaky_tests) {
      // initialize flakyJobGroups.jobName.testName object
      if (!(test.job_name in flakyJobGroups)) {
        flakyJobGroups[test.job_name] = {}
      }
  
      if (!(test.test_name in flakyJobGroups[test.job_name])) {
        flakyJobGroups[test.job_name][test.test_name] = {
          count: 0,
          lastSeen: 0,
          lastJob: 0,
        }
      }

      // now handle metrics for specific test in the job
      flakyJobGroups[test.job_name][test.test_name].count += test.times_flaked

      const testDate = Date.parse(test.workflow_created_at)
      if (testDate > flakyJobGroups[test.job_name][test.test_name].lastSeen) {
        flakyJobGroups[test.job_name][test.test_name].lastJob = test.job_number
        flakyJobGroups[test.job_name][test.test_name].lastSeen = testDate
      }
    }
  }
  
  // generate markdown results
  for (const [jobName, tests] of Object.entries(flakyJobGroups)) {
    console.log(`# ${jobName}\n`)
    console.log(`*(last ${lookbackDays} days)*\n`)
    console.log(`Test Name | Flake Count | Last Job`)
    console.log(`--- | --- | ---`)

    const results = []
    for (const [testName, metrics] of Object.entries(tests)) {
      const jobUrl = `https://app.circleci.com/pipelines/github/gatsbyjs/gatsby/jobs/${metrics.lastJob}/tests`
      results.push(`${testName} | ${metrics.count} | [${metrics.lastJob}](${jobUrl})`)
    }

    console.log(results.join(`\n`))
    console.log(`\n`)
  }
}

run()