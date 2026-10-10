from nbclassic_extras._version import __version__

__all__ = ["__version__"]


def _jupyter_server_extension_points():
    return [{"module": "nbclassic_extras.gist"}]
