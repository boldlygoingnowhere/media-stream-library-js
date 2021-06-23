const { pipelines } = window.mediaStreamLibrary

const play = (videoEl, rtspUri, wsProxyUri) => {
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

let pipeline = []

const camItems = document.querySelectorAll('div[data-camId]')

for (var camItem in camItems) if (camItems.hasOwnProperty(camItem)) {
  const camId = camItems[camItem].getAttribute('data-camId')
  const videoEl = camItems[camItem].getElementsByTagName('video')[0]
  camItems[camItem].getElementsByTagName('button')[0].addEventListener('click', async (e) => {
    pipeline[camItem] && pipeline[camItem].close()

    const rtspUri = document.querySelector('#rtspUri' + camId).value
    const wsProxyUri = document.querySelector('#wsProxyUri' + camId).value

    console.log(camId + ': RTSP=' + rtspUri + ',WS=' + wsProxyUri)
    pipeline[camItem] = play(videoEl, rtspUri, wsProxyUri)
  })
}
