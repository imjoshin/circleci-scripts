const {client, getS3File} = require("./util.js")

const failedCharacter = " │ ✖"

async function run() {
  // set up restraints for pipelines
  const lookbackDays = 30
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - lookbackDays);

  const ignoredJobs = [
    'lint',
    'windows_unit_tests',
    'unit_tests_node14',
    'unit_tests_node16',
    'unit_tests_node18',
    'starters_publish',
    'typecheck', 
    'bootstrap',
    'integration_tests_gatsby_cli',
  ]

  // variable setup
  const branchesBuiltInLookback = new Set()
  const failedJobGroups = {}

  // get recently used branches
  branchesBuiltInLookback.add('feat/mdx-v2-update-e2e-and-benchmark')

  // find workflows for each branch
  for (const branch of Array.from(branchesBuiltInLookback)) {
    let finishedGettingWorkflows = false
    let workflowPageToken = undefined
    const workflows = []

    // loop until we see an old dated pipeline
    while (!finishedGettingWorkflows) {
      if (workflowPageToken === null) {
        finishedGettingWorkflows = true
        break
      }

      const workflowResults = await client.get(
        `insights`,
        `workflows/build-test`,
        {
          branch,
          'page-token': workflowPageToken,
        }
      )

      workflowPageToken = workflowResults.next_page_token

      // find workflows within the date range
      for (const workflow of workflowResults.items) {
        const workflowDate = Date.parse(workflow.created_at)
        if (workflowDate <= startDate) {
          finishedGettingWorkflows = true
          break
        }

        workflows.push(workflow)
      }

      // find failed jobs within all of our workflows
      const failedJobs = []
      for (const workflow of workflows) {
        
        const jobResults = await client.get(
          `workflow`,
          `${workflow.id}/job`,
          {},
          {skipContext: true}
        )

        for (const job of jobResults.items) {
          if (ignoredJobs.indexOf(job.name) < 0 && job.status === 'failed') {
            failedJobs.push(job)
          }
        }
      }

      // parse logs for each failed job
      for (const job of failedJobs) {
        console.log(`${job.name}, ${job.job_number}`)
        // old API response is garbled, so manually parse logs
        const artifactsResults = await client.get(
          `project`,
          job.job_number,
          {},
          {
            raw: true,
            version: '1.1',
          }
        )

        const outputRegex = /:output_url \"([^"]+)\"/g
        const outputMatches = Array.from(artifactsResults.matchAll(outputRegex))

        if (!outputMatches) {
          continue
        }

        const specialCharsStrip = /\x1B\[(([0-9]+)(;[0-9]+)*)?[m,K,H,f,J]/g
        // const failedTestMatch = new RegExp(`${failedCharacter}\s+([^│]+)`, "g")
        const failedTestMatch = / │ ✖\s+([^│]+)/g

        // assume the last log was the one that failed
        const logUrl = outputMatches[outputMatches.length - 1][1]
        const log = await getS3File(logUrl)
        const logString = JSON.parse(log).map(l => l.message).join('\n').replace(specialCharsStrip, '')
        const failedLines = logString.matchAll(failedTestMatch)

        if (!failedLines) {
          continue
        }

        for (const failedLine of failedLines) {
          // Sometimes fileNames are too long and flow to the next line
          // Just going to ignore that for now because it's a bit rare
          const fileName = failedLine[1].split(/\s+/)[0]
          console.log(fileName)
        }
      }
    }
  }

  return

  // now that we have all recent branches, get all flaky tests
  // for those branches
  const flakyJobGroups = {}

  for (const branch of Array.from(branchesBuiltInLookback).slice(0, 1)) {
    const testResults = await client.get(
      'api/v2/insights/gh/gatsbyjs/gatsby/flaky-tests',
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