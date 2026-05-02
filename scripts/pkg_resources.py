import importlib.util
import os


def resource_filename(package, resource):
    spec = importlib.util.find_spec(package)
    if spec is None:
        raise ImportError(f"Package {package!r} not found")
    if spec.submodule_search_locations:
        pkg_path = list(spec.submodule_search_locations)[0]
    else:
        origin = spec.origin
        if not origin:
            raise ImportError(f"Can't determine path for package {package!r}")
        pkg_path = os.path.dirname(origin)
    return os.path.join(pkg_path, resource)


class DistributionShim:
    def __init__(self, name):
        self.project_name = name


def get_distribution(name):
    return DistributionShim(name)
