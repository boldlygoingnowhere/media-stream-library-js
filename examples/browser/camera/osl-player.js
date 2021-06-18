const { pipelines } = window.mediaStreamLibrary

const play = (rtspUri, wsProxyUri) => {
  const videoEl = document.querySelector('video')

  // Grab a reference to the video element
  let Pipeline = pipelines.Html5VideoPipeline
  let mediaElement = videoEl

  // Setup a new pipeline
  const pipeline = new Pipeline({
    ws: { uri: wsProxyUri },
    rtsp: { uri: rtspUri },
    mediaElement,
  })
  pipeline.ready.then(() => {
    pipeline.rtsp.play()
  })

  return pipeline
}

let pipeline

// Each time a device ip is entered, then play
const playButton = document.querySelector('#play')
playButton.addEventListener('click', async (e) => {
  pipeline && pipeline.close()

  const rtspUri = document.querySelector('#rtspUri').value
  const wsProxyUri = document.querySelector('#wsProxyUri').value

  console.log(rtspUri, wsProxyUri)
  pipeline = play(rtspUri, wsProxyUri)
})
